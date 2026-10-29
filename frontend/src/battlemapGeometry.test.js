import test from "node:test";
import assert from "node:assert/strict";
import { euclideanDistance, screenToWorld, snapPoint, zoomAt } from "./battlemapGeometry.js";

test("screen and world coordinates stay inverse under pan and zoom", () => {
  assert.deepEqual(screenToWorld({ x: 120, y: 80 }, { x: 20, y: 30, zoom: 2 }), { x: 50, y: 25 });
});

test("pointer-centered zoom preserves the pointed world coordinate", () => {
  const pointer = { x: 200, y: 150 };
  const before = { x: 10, y: 20, zoom: 1 };
  const after = zoomAt(before, pointer, 2);
  assert.deepEqual(screenToWorld(pointer, after), screenToWorld(pointer, before));
});

test("grid snapping honors offsets without moving stored points when grid changes", () => {
  assert.deepEqual(snapPoint({ x: 74, y: 91 }, { snap_enabled: true, grid_size: 50, grid_offset_x: 10, grid_offset_y: 15 }), { x: 60, y: 115 });
});

test("ruler is Euclidean and labeled in configured units", () => {
  assert.equal(euclideanDistance({ x: 0, y: 0 }, { x: 30, y: 40 }, { grid_size: 50, units_per_square: 5 }), 5);
});
