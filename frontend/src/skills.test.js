import assert from "node:assert/strict";
import test from "node:test";
import { ALL_SKILLS, canSelectSkill, pruneInvalidSkills, SKILL_BY_ID, SKILL_TIERS } from "./skills.js";

test("skill tree contains the official three tiers and bonuses", () => {
  assert.deepEqual(SKILL_TIERS.map(({ label, bonus }) => [label, bonus]), [["TRAINED", 10], ["EXPERT", 15], ["MASTER", 20]]);
  assert.equal(ALL_SKILLS.length, 42);
  assert.ok(ALL_SKILLS.every((skill) => skill.description));
});

test("advanced skills require a connected prerequisite", () => {
  assert.equal(canSelectSkill(SKILL_BY_ID.hacking, []), false);
  assert.equal(canSelectSkill(SKILL_BY_ID.hacking, ["computers"]), true);
  assert.deepEqual(pruneInvalidSkills(["computers", "hacking", "artificial-intelligence"]), ["computers", "hacking", "artificial-intelligence"]);
  assert.deepEqual(pruneInvalidSkills(["hacking", "artificial-intelligence"]), []);
});
