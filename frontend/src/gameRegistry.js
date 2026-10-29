export const GAME_REGISTRY = Object.freeze([
  { id: "dnd", label: "D&D", route: "/dnd", capabilities: ["battlemap"] },
  { id: "mothership", label: "Mothership", route: "/mothership", capabilities: ["sheets", "legacy-minimap"] },
]);

export const DEFAULT_GAME = "dnd";
export const gameById = (id) => GAME_REGISTRY.find((game) => game.id === id);

export function preferredGame() {
  const route = window.location.pathname.split("/").filter(Boolean)[0];
  return gameById(route)?.id || gameById(localStorage.getItem("tabletop-game"))?.id || DEFAULT_GAME;
}
