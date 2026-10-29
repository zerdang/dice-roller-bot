import test from "node:test";
import assert from "node:assert/strict";
import { itemMetrics, sortInventory, swapInventory } from "./inventory.js";

const items = [
  { id: 1, name: "Patch Kit", kind: "equipment", equipped: 0 },
  { id: 2, name: "Revolver", kind: "weapon", equipped: 1 },
  { id: 3, name: "Crew Armor", kind: "armor", equipped: 0 },
];

test("inventory can be sorted without changing its manual order", () => {
  assert.deepEqual(sortInventory(items, "name").map((item) => item.id), [3, 1, 2]);
  assert.deepEqual(items.map((item) => item.id), [1, 2, 3]);
  assert.equal(sortInventory(items, "equipped")[0].id, 2);
});

test("two inventory records can swap manual positions", () => {
  assert.deepEqual(swapInventory(items, 1, 3).map((item) => item.id), [3, 2, 1]);
});

test("weapon metrics use Mothership loadout fields", () => {
  assert.deepEqual(itemMetrics({ kind: "weapon", damage: "3d10", range_band: "20/100", wound: "Gunshot", shots: "6", ammo: 4, ammo_max: 6 }), [
    ["DMG", "3d10"], ["RNG", "20/100"], ["WOUND", "Gunshot"], ["AMMO", "4/6"],
  ]);
});
