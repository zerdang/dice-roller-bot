import assert from "node:assert/strict";
import test from "node:test";
import { clampStat, normalizeFixedStats, STAT_NAMES } from "./stats.js";

test("normalizes all eight fixed Mothership metrics", () => {
  const stats = normalizeFixedStats({ strength: "42", Combat: 61, Condition: 10 });
  assert.deepEqual(Object.keys(stats), STAT_NAMES);
  assert.equal(stats.Strength, 42);
  assert.equal(stats.Combat, 61);
  assert.equal(stats.Sanity, 0);
  assert.equal("Condition" in stats, false);
});

test("stat values are always bounded to the 0-99 range", () => {
  assert.equal(clampStat(-4), 0);
  assert.equal(clampStat(47), 47);
  assert.equal(clampStat(120), 99);
  assert.equal(clampStat("invalid"), 0);
});
