export function sortInventory(items, mode) {
  const copy = [...items];
  if (mode === "name") return copy.sort((a, b) => a.name.localeCompare(b.name));
  if (mode === "type") return copy.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  if (mode === "equipped") return copy.sort((a, b) => Number(b.equipped) - Number(a.equipped) || a.name.localeCompare(b.name));
  return copy;
}

export function swapInventory(items, firstId, secondId) {
  const first = items.findIndex((item) => item.id === firstId);
  const second = items.findIndex((item) => item.id === secondId);
  if (first < 0 || second < 0 || first === second) return items;
  const copy = [...items];
  [copy[first], copy[second]] = [copy[second], copy[first]];
  return copy;
}

export function itemMetrics(item) {
  if (item.kind === "weapon") return [
    ["DMG", item.damage], ["RNG", item.range_band], ["WOUND", item.wound],
    ["AMMO", item.ammo_max == null ? item.shots : `${item.ammo ?? 0}/${item.ammo_max}`],
  ].filter(([, value]) => value !== "" && value != null);
  if (item.kind === "armor") return [
    ["AP", item.armor_points], ["DR", item.damage_reduction],
  ].filter(([, value]) => value !== "" && value != null);
  return [["USES", item.uses_max == null ? null : `${item.uses ?? 0}/${item.uses_max}`]]
    .filter(([, value]) => value !== null);
}
