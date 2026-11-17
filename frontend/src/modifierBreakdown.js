export const signedModifier = value => `${value >= 0 ? "+" : ""}${value}`;
const title = value => value[0].toUpperCase() + value.slice(1);
const modifier = score => Math.floor((score - 10) / 2);

export function modifierBreakdown(card, type, name, ability) {
  const score = Number(card.ability_scores?.[ability] ?? 10);
  const source = card.ability_sources?.[ability];
  const parts = [];
  const scoreParts = [];
  if (source && Number.isFinite(source.base)) {
    let running = source.base;
    parts.push({ amount: modifier(running), label: `Base Points (score ${running})` });
    scoreParts.push({ amount: running, label: "Base Points" });
    for (const item of source.increases || []) {
      if (!Number.isFinite(item.points) || !item.points) continue;
      const next = running + item.points;
      parts.push({ amount: modifier(next) - modifier(running), label: `${item.label} (${signedModifier(item.points)} score)` });
      scoreParts.push({ amount: item.points, label: item.label });
      running = next;
    }
    if (running !== score) {
      parts.push({ amount: modifier(score) - modifier(running), label: `Recorded score changes (${signedModifier(score - running)} score)` });
      scoreParts.push({ amount: score - running, label: "Recorded score changes" });
    }
  } else parts.push({ amount: modifier(score), label: `Recorded ${title(ability)} score (${score})` });
  let total = modifier(score);
  let overridden = false;
  if (type !== "ability") {
    const training = card[type === "save" ? "save_training" : "skill_training"]?.[name] || {};
    const tier = Math.max(0, Math.min(type === "save" ? 1 : 2, Number(training.tier || 0)));
    const proficiency = Number(card.proficiency_bonus ?? 2) * tier;
    parts.push({ amount: proficiency, label: tier === 2 ? "Expertise (double proficiency)" : tier === 1 ? "Proficiency" : "Not proficient" });
    const adjustment = Number(training.adjustment || 0);
    if (adjustment) parts.push({ amount: adjustment, label: training.adjustment_source || "Other adjustment" });
    total += proficiency + adjustment;
    if (training.override != null && training.override !== "") {
      const override = Number(training.override);
      parts.push({ amount: override - total, label: `Manual override (sets total to ${signedModifier(override)})` });
      total = override;
      overridden = true;
    }
  }
  return {
    heading: type === "ability" ? `${score} ${title(ability)} (${signedModifier(total)})` : `${type === "save" ? `${title(ability)} saving throw` : name} (${signedModifier(total)})`,
    ability: `${score} ${title(ability)} (${signedModifier(modifier(score))})`,
    parts, scoreParts, total, overridden,
    note: !source ? "Source details can be added under Abilities → Edit → Score sources." : "Score-point increases change the modifier only when a two-point threshold is crossed.",
  };
}
