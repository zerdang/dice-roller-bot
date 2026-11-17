import assert from "node:assert/strict";
import test from "node:test";
import { catalogByCategory, EQUIPMENT_CATALOG, equipmentPayload } from "./equipment.js";

test("the supplied equipment tables are represented in the static catalog", () => {
  assert.equal(EQUIPMENT_CATALOG.length, 43);
  assert.equal(catalogByCategory("armor").length, 5);
  assert.equal(catalogByCategory("weapon").length, 7);
  assert.equal(catalogByCategory("equipment").length, 31);
  assert.ok(EQUIPMENT_CATALOG.every((item) => item.cost >= 0 && item.description));
});

test("catalog records convert to persisted inventory payloads", () => {
  const automed = EQUIPMENT_CATALOG.find((item) => item.id === "automed");
  assert.deepEqual(equipmentPayload(automed), {
    catalog_key: "automed", name: "Automed", kind: "equipment", quantity: 6,
    cost: 300, details: automed.description, special: automed.description, equipped: false,
    damage: "",
  });
});

test("combat gun catalog carries the seven supplied damage profiles", () => {
  assert.deepEqual(
    Object.fromEntries(catalogByCategory("weapon").map((item) => [item.name, item.damage])),
    {
      "SK 109 Seeker Smart Rifle": "1d10",
      "F20 Arbiter Pulse Rifle": "5d10",
      "KANO X9 Combat Shotgun": "2d10",
      "ARMA 29 Submachine Gun": "4d10",
      "FN Slug Gun Revolver": "3d10",
      "Peabody Flare Gun": "1d10",
      "D&C 7 Tranquilizer Pistol": "N/A",
    },
  );
});
