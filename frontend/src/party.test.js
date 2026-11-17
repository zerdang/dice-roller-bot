import test from "node:test";
import assert from "node:assert/strict";
import { groupPartyRoster } from "./party.js";

test("party groups use controller identity and put active before recently edited sheets", () => {
  const roster = [
    { id: 4, name: "Old", controller_key: "a", controller_name: "Alex", updated_at: "2026-01-01" },
    { id: 2, name: "Recent", controller_key: "a", controller_name: "Alex", updated_at: "2026-05-01" },
    { id: 3, name: "Active", controller_key: "a", controller_name: "Alex", is_active: true, updated_at: "2025-01-01" },
    { id: 1, name: "Other", controller_key: "b", controller_name: "Alex" },
  ];
  const groups = groupPartyRoster(roster);
  assert.equal(groups.length, 2); // Matching display names must not merge players.
  assert.deepEqual(groups[0].characters.map(card => card.id), [3, 2, 4]);
  assert.deepEqual(roster.map(card => card.id), [4, 2, 3, 1]);
  assert.deepEqual(groupPartyRoster(roster, "recent")[0].characters.map(card => card.id), [2]);
  assert.equal(groupPartyRoster(roster, "Alex").length, 2);
});
