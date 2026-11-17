import assert from "node:assert/strict";
import test from "node:test";
import { adjustMaxWounds, applyClass, CLASS_DATA } from "./classes.js";

const rolled = { Strength: 44, Speed: 31, Intellect: 26, Combat: 30 };

test("class selection applies the primary bonus and all four base saves", () => {
  const teamster = applyClass(rolled, "", "teamster");
  assert.equal(teamster.Strength, 49);
  assert.deepEqual(
    [teamster.Sanity, teamster.Fear, teamster.Body, teamster.Armor],
    [30, 35, 30, 35],
  );
});

test("switching class removes the old bonus before adding the new one", () => {
  const teamster = applyClass(rolled, "", "teamster");
  const scientist = applyClass(teamster, "teamster", "scientist");
  assert.equal(scientist.Strength, 44);
  assert.equal(scientist.Intellect, 36);
  assert.equal(scientist.Sanity, CLASS_DATA.scientist.saves.Sanity);
});

test("selecting the same class again does not stack its bonus", () => {
  const marine = applyClass(rolled, "", "marine");
  assert.equal(applyClass(marine, "marine", "marine").Combat, 35);
});

test("marine and android class changes adjust maximum wounds without stacking", () => {
  assert.equal(adjustMaxWounds(2, "", "marine"), 3);
  assert.equal(adjustMaxWounds(3, "marine", "android"), 3);
  assert.equal(adjustMaxWounds(3, "android", "scientist"), 2);
});
