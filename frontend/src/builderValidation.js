const ABILITIES = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];
const title = text => text[0].toUpperCase() + text.slice(1);
const ARRAY = [15, 14, 13, 12, 10, 8];
const COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };

export function stepBoost(draft, preview, ability, delta) {
  const value = draft.boosts[ability] + delta;
  if (value < 0 || value > 2) return null;
  const boosts = { ...draft.boosts, [ability]: value };
  if (delta > 0) {
    // Partial spending must still be completable under the campaign's rules.
    const completable = preview.boost_options?.some(option => ABILITIES.every(a =>
      boosts[a] <= (option[a] || 0) && draft.scores[a] + (option[a] || 0) <= 20));
    if (!completable) return null;
  }
  return { ...draft, boosts };
}

export function stepBaseScore(draft, preview, ability, delta) {
  const scores = { ...draft.scores };
  const current = scores[ability];
  let value = current + delta;
  if (["array", "rolled"].includes(draft.method)) {
    const pool = draft.method === "rolled" ? preview.roll_pool?.totals || [] : ARRAY;
    const candidates = [...new Set(pool)].filter(n => delta > 0 ? n > current : n < current).sort((a, b) => a - b);
    value = delta > 0 ? candidates[0] : candidates.at(-1);
    if (value === undefined) return null;
    const other = ABILITIES.find(a => a !== ability && scores[a] === value);
    if (!other) return null;
    scores[other] = current;
    if (scores[other] + draft.boosts[other] > 20) return null;
  } else if (draft.method === "point_buy") {
    if (!(value in COST)) return null;
    if (delta > 0 && ABILITIES.reduce((sum, a) => sum + (a === ability ? COST[value] : COST[scores[a]] ?? Infinity), 0) > 27) return null;
  } else if (value < 1 || value > 20) return null;
  if (delta > 0 && value + draft.boosts[ability] > 20) return null;
  scores[ability] = value;
  return { ...draft, scores };
}

// Valid combinations come from the server's pinned background and campaign rules.
export function abilityIssues(draft, preview) {
  if (!preview.boost_options?.length) return [];
  const issues = [];
  const eligible = preview.eligible_boosts;
  const wrong = ABILITIES.filter(a => draft.boosts[a] && !eligible.includes(a));
  for (const ability of wrong) issues.push({ step: "abilities", fields: [`boosts.${ability}`], message: `${title(ability)} is not eligible for this background. Set its background increase to +0; use ${eligible.map(title).join(", ")} instead.` });
  if (!wrong.length && !preview.boost_options.some(option => ABILITIES.every(a => draft.boosts[a] === (option[a] || 0)))) {
    issues.push({ step: "abilities", fields: eligible.map(a => `boosts.${a}`), message: `You assigned +${Object.values(draft.boosts).reduce((sum, n) => sum + n, 0)} in background increases. Assign +2/+1 to two different eligible abilities, or +1 to three, using one allowed background combination.` });
  }
  for (const ability of ABILITIES) {
    const total = draft.scores[ability] + draft.boosts[ability];
    if (total > 20) issues.push({ step: "abilities", fields: [`scores.${ability}`, `boosts.${ability}`], message: `${title(ability)} totals ${total}. Background increases cannot raise an ability above 20; lower its base score or increase.` });
  }
  return issues;
}

export function suggestedBoosts(draft, preview) {
  const options = (preview.boost_options || []).filter(option => ABILITIES.every(a => draft.scores[a] + (option[a] || 0) <= 20));
  // Preserve as much of the player's current allocation as possible.
  const distance = option => ABILITIES.reduce((sum, a) => sum + Math.abs(draft.boosts[a] - (option[a] || 0)), 0);
  options.sort((a, b) => distance(a) - distance(b));
  return options.length ? Object.fromEntries(ABILITIES.map(a => [a, options[0][a] || 0])) : null;
}
