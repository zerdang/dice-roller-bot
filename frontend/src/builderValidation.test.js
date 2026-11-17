import test from "node:test";
import assert from "node:assert/strict";
import { stepBoost, stepBaseScore } from "./builderValidation.js";

const abilities = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];
const draft = () => ({ method: "array", scores: Object.fromEntries(abilities.map((a, i) => [a, [15, 14, 13, 12, 10, 8][i]])), boosts: Object.fromEntries(abilities.map(a => [a, 0])) });
const unrestricted = { boost_options: abilities.flatMap(a => abilities.filter(b => a !== b).map(b => ({ [a]: 2, [b]: 1 }))).concat([{ strength: 1, wisdom: 1, charisma: 1 }]) };

test("three clicks spend the ability budget, block overspending and +3, and allow refunds", () => {
  let current = stepBoost(draft(), unrestricted, "wisdom", 1);
  current = stepBoost(current, unrestricted, "wisdom", 1);
  assert.equal(stepBoost(current, unrestricted, "wisdom", 1), null);
  current = stepBoost(current, unrestricted, "charisma", 1);
  for (const ability of abilities) assert.equal(stepBoost(current, unrestricted, ability, 1), null);
  current = stepBoost(current, unrestricted, "wisdom", -1);
  assert.ok(stepBoost(current, unrestricted, "charisma", 1));
  assert.equal(stepBoost(current, unrestricted, "strength", -1), null);
});

test("partial spending cannot enter a dead end between distinct allowed combinations", () => {
  const restricted = { boost_options: [{ strength: 2, dexterity: 1 }, { wisdom: 2, charisma: 1 }] };
  let current = stepBoost(draft(), restricted, "strength", 1);
  assert.equal(stepBoost(current, restricted, "wisdom", 1), null);
  assert.equal(stepBoost(current, restricted, "constitution", 1), null);
  current = stepBoost(current, restricted, "dexterity", 1);
  assert.equal(stepBoost(current, restricted, "dexterity", 1), null);
  assert.ok(stepBoost(current, restricted, "strength", 1));
});

test("old invalid allocations can be reduced and repaired", () => {
  const restricted = { boost_options: [{ strength: 2, dexterity: 1 }] };
  const current = { ...draft(), boosts: { ...draft().boosts, strength: 2, wisdom: 1 } };
  assert.equal(stepBoost(current, restricted, "dexterity", 1), null);
  const repaired = stepBoost(current, restricted, "wisdom", -1);
  assert.ok(stepBoost(repaired, restricted, "dexterity", 1));
});

test("both controls respect the total-score cap while allowing decreases", () => {
  const current = { ...draft(), method: "manual", scores: { ...draft().scores, wisdom: 19 } };
  const boosted = stepBoost(current, unrestricted, "wisdom", 1);
  assert.ok(boosted);
  assert.equal(stepBoost(boosted, unrestricted, "wisdom", 1), null);
  assert.equal(stepBaseScore(boosted, unrestricted, "wisdom", 1), null);
  assert.ok(stepBaseScore(boosted, unrestricted, "wisdom", -1));
});

test("standard-array buttons swap assignments and preserve the six-value pool", () => {
  const current = draft();
  assert.equal(stepBaseScore(current, {}, "strength", 1), null);
  const next = stepBaseScore(current, {}, "strength", -1);
  assert.equal(next.scores.strength, 14);
  assert.equal(next.scores.dexterity, 15);
  assert.deepEqual(Object.values(next.scores).sort(), Object.values(current.scores).sort());
  assert.equal(current.scores.strength, 15);
});

test("recorded-roll buttons require a pool and swap repeated recorded totals safely", () => {
  const current = { ...draft(), method: "rolled", scores: { strength: 18, dexterity: 14, constitution: 14, intelligence: 12, wisdom: 10, charisma: 8 } };
  assert.equal(stepBaseScore(current, {}, "strength", -1), null);
  const preview = { roll_pool: { totals: [18, 14, 14, 12, 10, 8] } };
  const next = stepBaseScore(current, preview, "strength", -1);
  assert.deepEqual(Object.values(next.scores).sort(), [...preview.roll_pool.totals].sort());
  assert.equal(next.scores.strength, 14);
});

test("point-buy buttons charge the cost curve and cannot exceed 27 points or 8–15 bounds", () => {
  const current = { ...draft(), method: "point_buy", scores: { strength: 15, dexterity: 15, constitution: 14, intelligence: 10, wisdom: 8, charisma: 8 } };
  assert.equal(stepBaseScore(current, {}, "strength", 1), null);
  assert.equal(stepBaseScore(current, {}, "wisdom", -1), null);
  // 27 points spent; no increment fits until points are refunded.
  assert.equal(stepBaseScore(current, {}, "constitution", 1), null);
  const next = stepBaseScore(current, {}, "strength", -1);
  assert.ok(stepBaseScore(next, {}, "constitution", 1));
});
