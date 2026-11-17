import test from "node:test";
import assert from "node:assert/strict";
import { COMMON_ACTIONS, characterActions, actionCategory, actionSlot, readTurn } from "./dndActions.js";

test("the 2024 guide includes all twelve core actions and distinguishes Help from the Aid spell", () => {
  assert.equal(COMMON_ACTIONS.filter(item => item.category === "Action").length, 12);
  assert.ok(COMMON_ACTIONS.some(item => item.name === "Help"));
  assert.ok(COMMON_ACTIONS.some(item => item.name === "Magic"));
  assert.equal(characterActions({ spells: [{ name: "Aid", casting_time: "1 action" }] })[0].name, "Aid");
});

test("casting times route reminders to their actual action costs, without guessing unknown costs", () => {
  assert.equal(actionCategory("1 Bonus Action"), "Bonus Action");
  assert.equal(actionCategory("1 Reaction, when hit"), "Reaction");
  assert.equal(actionCategory("2 actions"), "Other");
  assert.equal(actionCategory(""), "Other");
  const rows = characterActions({ spells: [{ name: "Shield", casting_time: "1 reaction" }, { name: "Ritual", casting_time: "10 minutes" }, { name: "Custom" }] });
  assert.equal(rows[0].category, "Reaction");
  assert.equal(rows[1].category, "Action");
  assert.match(rows[1].notes, /each turn; Concentration/);
  assert.equal(rows[2].category, "Other");
  assert.equal(actionSlot(rows[2].category), null);
});

test("equipment reminders use 2024 healing-potion and tinderbox timing and exclude depleted items", () => {
  const rows = characterActions({ inventory: [
    { name: "Potion of Healing", quantity: 2 }, { name: "Healer’s Kit", quantity: 1 }, { name: "Torch", quantity: 1 }, { name: "Tinderbox", quantity: 1 },
    { name: "Rope", quantity: 0 }, { name: "Unknown Relic", quantity: 1 },
  ] });
  assert.equal(rows.find(row => row.name === "Potion of Healing").category, "Bonus Action");
  assert.equal(rows.find(row => row.name === "Healer’s Kit").category, "Action");
  assert.equal(rows.find(row => row.name === "Light a torch").category, "Bonus Action");
  assert.ok(!rows.some(row => row.name === "Rope"));
  assert.equal(rows.find(row => row.name === "Unknown Relic").category, "Other");
});

test("reminders are deduplicated while keeping spells and equipment with the same name distinct", () => {
  const rows = characterActions({ inventory: [{ name: "Longsword" }, { name: "Longsword" }, { name: "Shield" }], attacks: [{ name: "Longsword" }], spells: [{ name: "Shield", casting_time: "1 reaction" }] });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.origin).sort(), ["Equipment", "Spell"]);
});

test("class identity alone does not invent bonus actions or features", () => {
  assert.deepEqual(characterActions({ identity: { class_name: "Rogue" }, features: [{ name: "Unclassified feature" }] }), []);
  assert.equal(characterActions({ features: [{ name: "Cunning Action", activation: "Bonus Action" }] })[0].category, "Bonus Action");
});

test("turn tracking recovers from old or malformed data and accepts only explicit true flags", () => {
  assert.deepEqual(readTurn({ turn_2024: "broken" }), { action: false, bonus: false, reaction: false, interaction: false });
  assert.deepEqual(readTurn({ turn_2024: JSON.stringify({ action: true, bonus: "false", reaction: 1 }) }), { action: true, bonus: false, reaction: false, interaction: false });
});
