import test from "node:test";
import assert from "node:assert/strict";
import { modifierBreakdown } from "./modifierBreakdown.js";

const card = {
  ability_scores: { charisma: 14 }, proficiency_bonus: 3,
  ability_sources: { charisma: { base: 12, increases: [{ label: "Species Points", points: 1 }, { label: "XYZ Equipment", points: 1 }] } },
};
const sumsToTotal = data => assert.equal(data.parts.reduce((sum, row) => sum + row.amount, 0), data.total);

test("source point increases are converted through modifier thresholds, not added as roll bonuses", () => {
  const data = modifierBreakdown(card, "ability", "charisma", "charisma");
  assert.equal(data.heading, "14 Charisma (+2)");
  assert.deepEqual(data.parts.map(row => row.amount), [1, 0, 1]);
  assert.match(data.parts[1].label, /Species Points.*\+1 score/);
  assert.match(data.parts[2].label, /XYZ Equipment/);
  assert.equal(data.scoreParts.reduce((sum, row) => sum + row.amount, 0), 14);
  sumsToTotal(data);
});

test("skills itemize expertise, a named equipment adjustment, and an override to zero", () => {
  const data = modifierBreakdown({ ...card, skill_training: { Persuasion: { tier: 2, adjustment: 1, adjustment_source: "XYZ Equipment", override: 0 } } }, "skill", "Persuasion", "charisma");
  assert.equal(data.total, 0);
  assert.equal(data.parts.find(row => row.label.includes("Expertise")).amount, 6);
  assert.equal(data.parts.find(row => row.label === "XYZ Equipment").amount, 1);
  assert.equal(data.parts.at(-1).amount, -9);
  assert.match(data.parts.at(-1).label, /override/);
  sumsToTotal(data);
});

test("saving throws cap proficiency at one tier and respect zero proficiency bonus", () => {
  const trained = { ...card, save_training: { charisma: { tier: 2, adjustment: -1, adjustment_source: "Armor penalty" } } };
  const data = modifierBreakdown(trained, "save", "charisma", "charisma");
  assert.equal(data.total, 4);
  sumsToTotal(data);
  const zero = modifierBreakdown({ ...trained, proficiency_bonus: 0 }, "save", "charisma", "charisma");
  assert.equal(zero.total, 1);
  sumsToTotal(zero);
});

test("manual score changes reconcile retained creation sources with the current score", () => {
  const data = modifierBreakdown({ ...card, ability_scores: { charisma: 17 } }, "ability", "charisma", "charisma");
  assert.equal(data.total, 3);
  assert.match(data.parts.at(-1).label, /Recorded score changes.*\+3 score/);
  sumsToTotal(data);
});

test("manual sheets use recorded values without inventing species or equipment sources", () => {
  const data = modifierBreakdown({ ability_scores: { charisma: 9 } }, "ability", "charisma", "charisma");
  assert.deepEqual(data.parts, [{ amount: -1, label: "Recorded Charisma score (9)" }]);
  sumsToTotal(data);
});
