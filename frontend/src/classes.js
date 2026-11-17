import { normalizeFixedStats } from "./stats.js";

export const CLASS_DATA = {
  teamster: {
    name: "Teamster",
    bonus: { Strength: 5 },
    bonusText: "+5 Strength",
    saves: { Sanity: 30, Fear: 35, Body: 30, Armor: 35 },
    feature: "Once per session, take Advantage on a Panic Check.",
    maxWoundsBonus: 0,
  },
  android: {
    name: "Android",
    bonus: { Speed: 5 },
    bonusText: "+5 Speed",
    saves: { Sanity: 20, Fear: 85, Body: 40, Armor: 25 },
    feature: "Fear saves made near Androids have disadvantage.",
    maxWoundsBonus: 1,
  },
  scientist: {
    name: "Scientist",
    bonus: { Intellect: 10 },
    bonusText: "+10 Intellect",
    saves: { Sanity: 40, Fear: 25, Body: 25, Armor: 30 },
    feature: "When a Scientist fails a Sanity save, nearby allies gain 1 Stress.",
    maxWoundsBonus: 0,
  },
  marine: {
    name: "Marine",
    bonus: { Combat: 5 },
    bonusText: "+5 Combat; +5 more near a friendly Marine",
    saves: { Sanity: 25, Fear: 30, Body: 35, Armor: 40 },
    feature: "When a Marine Panics, nearby allies must make a Fear save.",
    maxWoundsBonus: 1,
  },
};

export function applyClass(stats, previousClass, nextClass) {
  const next = normalizeFixedStats(stats);
  const previousBonus = CLASS_DATA[previousClass]?.bonus || {};
  const classData = CLASS_DATA[nextClass];

  for (const [name, bonus] of Object.entries(previousBonus)) {
    next[name] = Math.max(0, next[name] - bonus);
  }
  if (!classData) return next;

  Object.assign(next, classData.saves);
  for (const [name, bonus] of Object.entries(classData.bonus)) {
    next[name] = Math.min(99, next[name] + bonus);
  }
  return next;
}

export function adjustMaxWounds(currentMaximum, previousClass, nextClass) {
  const current = Math.max(1, Number.parseInt(currentMaximum, 10) || 2);
  const previousBonus = CLASS_DATA[previousClass]?.maxWoundsBonus || 0;
  const nextBonus = CLASS_DATA[nextClass]?.maxWoundsBonus || 0;
  return Math.max(1, current - previousBonus + nextBonus);
}
