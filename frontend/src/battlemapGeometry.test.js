import test from "node:test";
import assert from "node:assert/strict";
import { annotationBounds, boundsIntersect, euclideanDistance, normalizedRect, screenToWorld, snapPoint, tokenBounds, zoomAt } from "./battlemapGeometry.js";

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

test("drag rectangles normalize in every direction and intersect map objects", () => {
  const marquee = normalizedRect({ x: 120, y: 90 }, { x: 20, y: 10 });
  assert.deepEqual(marquee, { x: 20, y: 10, width: 100, height: 80 });
  assert.equal(boundsIntersect(marquee, tokenBounds({ x: 110, y: 50, size: 1 }, 20)), true);
  assert.equal(boundsIntersect(marquee, tokenBounds({ x: 150, y: 50, size: 1 }, 20)), false);
});

test("annotation bounds cover lines and radial drawings", () => {
  assert.deepEqual(annotationBounds({ kind: "circle", geometry: { x: 50, y: 60, radius: 10 } }), { x: 40, y: 50, width: 20, height: 20 });
  assert.deepEqual(annotationBounds({ kind: "line", geometry: { x: 30, y: 40, x2: 10, y2: 5 } }), { x: 7, y: 2, width: 26, height: 41 });
});
