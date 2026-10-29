export const STAT_GROUPS = [
  { label: "PRIMARY ATTRIBUTES", fields: ["Strength", "Speed", "Intellect", "Combat"] },
  { label: "SAVING THROWS", fields: ["Sanity", "Fear", "Body", "Armor"] },
];

export const STAT_NAMES = STAT_GROUPS.flatMap((group) => group.fields);

export function clampStat(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(99, parsed)) : 0;
}

export function normalizeFixedStats(stats = {}) {
  const entries = Object.entries(stats);
  return Object.fromEntries(STAT_NAMES.map((name) => {
    const match = entries.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return [name, clampStat(match?.[1] ?? 0)];
  }));
}
