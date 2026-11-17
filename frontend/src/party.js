export function groupPartyRoster(roster, query = "") {
  const groups = new Map();
  for (const card of roster) {
    const key = card.controller_key || "unassigned";
    if (!groups.has(key)) groups.set(key, { key, name: card.controller_name || "Unassigned", isDm: Boolean(card.controller_is_dm), isOwn: Boolean(card.is_own), characters: [] });
    groups.get(key).characters.push(card);
  }
  const search = query.trim().toLocaleLowerCase();
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key)).map(group => ({
    ...group,
    characters: group.characters.filter(card => !search || [group.name, card.name, card.identity?.class_name, card.identity?.species].filter(Boolean).join(" ").toLocaleLowerCase().includes(search))
      .sort((a, b) => Number(Boolean(b.is_active)) - Number(Boolean(a.is_active)) || (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0) || a.id - b.id),
  })).filter(group => group.characters.length);
}
