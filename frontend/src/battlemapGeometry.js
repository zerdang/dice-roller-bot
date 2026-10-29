export function screenToWorld(point, view) {
  return { x: (point.x - view.x) / view.zoom, y: (point.y - view.y) / view.zoom };
}

export function zoomAt(view, screenPoint, nextZoom) {
  const zoom = Math.max(0.1, Math.min(5, nextZoom));
  const world = screenToWorld(screenPoint, view);
  return { zoom, x: screenPoint.x - world.x * zoom, y: screenPoint.y - world.y * zoom };
}

export function snapPoint(point, scene) {
  if (!scene?.snap_enabled) return point;
  const size = Number(scene.grid_size) || 1;
  const offsetX = Number(scene.grid_offset_x) || 0;
  const offsetY = Number(scene.grid_offset_y) || 0;
  return {
    x: offsetX + Math.round((point.x - offsetX) / size) * size,
    y: offsetY + Math.round((point.y - offsetY) / size) * size,
  };
}

export function euclideanDistance(start, end, scene) {
  const pixels = Math.hypot(end.x - start.x, end.y - start.y);
  return pixels / (Number(scene?.grid_size) || 1) * (Number(scene?.units_per_square) || 1);
}

export function conePath(geometry) {
  const { x = 0, y = 0, radius = 1, angle = 60, rotation = 0 } = geometry;
  const start = (rotation - angle / 2) * Math.PI / 180;
  const end = (rotation + angle / 2) * Math.PI / 180;
  const first = [x + radius * Math.cos(start), y + radius * Math.sin(start)];
  const last = [x + radius * Math.cos(end), y + radius * Math.sin(end)];
  return `M ${x} ${y} L ${first[0]} ${first[1]} A ${radius} ${radius} 0 ${angle > 180 ? 1 : 0} 1 ${last[0]} ${last[1]} Z`;
}
