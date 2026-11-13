import { useCallback, useEffect, useRef, useState } from "react";
import { conePath, euclideanDistance, screenToWorld, snapPoint, zoomAt } from "./battlemapGeometry.js";

const TOOLS = ["select", "pan", "token", "marker", "ruler"];
const SHAPE_TOOLS = ["circle", "cone", "line", "rectangle"];
const DND_CONDITIONS = ["Blinded", "Charmed", "Deafened", "Frightened", "Grappled", "Incapacitated", "Invisible", "Paralyzed", "Petrified", "Poisoned", "Prone", "Restrained", "Stunned", "Unconscious"];

function ToolIcon({ name }) {
  const paths = {
    select: <path d="M6 3l12 11-6 .8 3.5 6-3 1.7-3.4-6-4 4z" />,
    pan: <path d="M8 11V7a2 2 0 014 0v3-5a2 2 0 014 0v5-3a2 2 0 014 0v4-2a2 2 0 014 0v5c0 5-3 8-8 8-3 0-5-2-7-5l-2-3a2 2 0 013-2z" />,
    token: <><circle cx="12" cy="9" r="4" /><path d="M5 21c.7-4 3-6 7-6s6.3 2 7 6" /></>,
    marker: <><path d="M12 22s7-7 7-13a7 7 0 10-14 0c0 6 7 13 7 13z" /><circle cx="12" cy="9" r="2" /></>,
    ruler: <path d="M4 17L17 4l3 3L7 20zM10 11l3 3m0-6l3 3M7 14l3 3" />,
    circle: <circle cx="12" cy="12" r="7" />,
    cone: <path d="M5 19L12 4l7 15z" />,
    line: <path d="M5 19L19 5" />,
    rectangle: <rect x="5" y="6" width="14" height="12" rx="1" />,
    fit: <path d="M9 4H4v5m11-5h5v5M9 20H4v-5m11 5h5v-5" />,
    reset: <path d="M5 8a8 8 0 111 10m-1 2v-6h6" />,
    shapes: <><circle cx="9" cy="9" r="4" /><rect x="11" y="11" width="8" height="8" /></>,
  };
  return <svg className="tool-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function ToolButton({ name, label = name, active = false, disabled = false, onClick }) {
  return <button type="button" className={`map-tool-button${active ? " active" : ""}`} data-label={label} aria-label={label} aria-pressed={active} disabled={disabled} onClick={onClick}><ToolIcon name={name} /></button>;
}

function annotationShape(item) {
  const g = item.geometry || {};
  const common = { fill: item.color, fillOpacity: item.opacity, stroke: item.color, strokeWidth: 3 };
  if (item.kind === "circle") return <circle {...common} cx={g.x} cy={g.y} r={g.radius || 50} />;
  if (item.kind === "cone") return <path {...common} d={conePath(g)} />;
  if (item.kind === "line") return <line {...common} x1={g.x} y1={g.y} x2={g.x2} y2={g.y2} fill="none" />;
  if (item.kind === "rectangle") return <rect {...common} x={g.x} y={g.y} width={g.width || 100} height={g.height || 100} transform={`rotate(${g.rotation || 0} ${g.x} ${g.y})`} />;
  return <g><circle {...common} cx={g.x} cy={g.y} r="16" /><text x={g.x} y={g.y + 4} textAnchor="middle">{item.icon || "!"}</text></g>;
}

const operation = (payload = {}) => ({ ...payload, operation_id: crypto.randomUUID() });

function TokenVisual({ token, size, request }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let objectUrl = "";
    if (!token.portrait_asset_id) { setUrl(""); return undefined; }
    request(`/api/battlemap/assets/${token.portrait_asset_id}`, { raw: true })
      .then((response) => response.blob()).then((blob) => { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); });
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [request, token.portrait_asset_id]);
  return url ? <image href={url} x={-size / 2} y={-size / 2} width={size} height={size} preserveAspectRatio="xMidYMid slice" clipPath="circle(50%)" /> : <circle r={size / 2} fill={token.color} />;
}

function AssetThumbnail({ assetId, request, alt = "" }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let objectUrl = "";
    if (!assetId) { setUrl(""); return undefined; }
    request(`/api/battlemap/assets/${assetId}`, { raw: true }).then((response) => response.blob()).then((blob) => {
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch(() => setUrl(""));
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [assetId, request]);
  return url ? <img src={url} alt={alt} /> : <span className="asset-placeholder" aria-hidden="true">◇</span>;
}

export default function Battlemap({ dashboard, request, reportError, renderDock }) {
  const [scenes, setScenes] = useState([]);
  const [sceneId, setSceneId] = useState(null);
  const [state, setState] = useState({ scene: null, tokens: [], annotations: [], presets: [] });
  const [tool, setTool] = useState("select");
  const [selectedId, setSelectedId] = useState(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState(null);
  const [view, setView] = useState({ x: 20, y: 20, zoom: 1 });
  const [interaction, setInteraction] = useState(null);
  const [pending, setPending] = useState(false);
  const [connected, setConnected] = useState(true);
  const [ping, setPing] = useState(null);
  const [sharedPings, setSharedPings] = useState([]);
  const [mapUrl, setMapUrl] = useState("");
  const [folders, setFolders] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [sceneBrowserOpen, setSceneBrowserOpen] = useState(false);
  const [templateBrowserOpen, setTemplateBrowserOpen] = useState(false);
  const [sceneSearch, setSceneSearch] = useState("");
  const [sceneFolder, setSceneFolder] = useState("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [pendingCharacter, setPendingCharacter] = useState(null);
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
  const svgRef = useRef(null);
  const stageRef = useRef(null);
  const workspaceRef = useRef(null);
  const isWarden = dashboard.role === "warden";
  const playerId = dashboard.characters?.[0]?.id;

  const loadScenes = useCallback(async () => {
    const list = await request("/api/battlemap/scenes");
    setScenes(list);
    setSceneId((current) => current && list.some((item) => item.id === current) ? current : list.find((item) => item.is_active)?.id || list[0]?.id || null);
  }, [request]);

  const loadPreparation = useCallback(async () => {
    if (!isWarden) return;
    const [nextFolders, nextTemplates] = await Promise.all([
      request("/api/battlemap/scene-folders"), request("/api/battlemap/creature-templates"),
    ]);
    setFolders(nextFolders); setTemplates(nextTemplates);
  }, [isWarden, request]);

  const refresh = useCallback(async () => {
    try {
      const [next, pings] = await Promise.all([request(`/api/battlemap/state${sceneId ? `?scene_id=${sceneId}` : ""}`), request("/api/battlemap/pings")]);
      if (!interaction) setState(next);
      setSharedPings(pings.filter((item) => !sceneId || item.scene_id === sceneId));
      setConnected(true);
    } catch (error) {
      setConnected(false);
      reportError(error);
    }
  }, [interaction, reportError, request, sceneId]);

  useEffect(() => { loadScenes().catch(reportError); }, [loadScenes, reportError]);
  useEffect(() => { loadPreparation().catch(reportError); }, [loadPreparation, reportError]);
  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 750);
    return () => window.clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    let url = "";
    if (!state.scene?.asset_id) { setMapUrl(""); return undefined; }
    request(`/api/battlemap/assets/${state.scene.asset_id}`, { raw: true })
      .then((response) => response.blob()).then((blob) => { url = URL.createObjectURL(blob); setMapUrl(url); })
      .catch(reportError);
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [reportError, request, state.scene?.asset_id]);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const handleWheel = (event) => {
      event.preventDefault();
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cursor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      setView((old) => zoomAt(old, cursor, old.zoom * (event.deltaY < 0 ? 1.12 : .89)));
    };
    stage.addEventListener("wheel", handleWheel, { passive: false });
    return () => stage.removeEventListener("wheel", handleWheel);
  }, [state.scene?.id]);

  const point = (event) => {
    const rect = svgRef.current.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const worldPoint = (event) => screenToWorld(point(event), view);
  const canMove = (token) => isWarden || (!token.locked && token.owners?.includes(playerId));
  const canEditAnnotation = (item) => isWarden || (!item.locked && item.creator_character_id === playerId);

  const fit = () => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !state.scene) return;
    const zoom = Math.min(rect.width / state.scene.width, rect.height / state.scene.height) * .94;
    setView({ zoom, x: (rect.width - state.scene.width * zoom) / 2, y: (rect.height - state.scene.height * zoom) / 2 });
  };

  const mutate = async (call) => {
    setPending(true);
    try { await call(); await refresh(); }
    catch (error) { reportError(error); await refresh(); }
    finally { setPending(false); }
  };

  const createScene = () => {
    const name = window.prompt("Scene name", `Scene ${scenes.length + 1}`);
    if (!name) return;
    mutate(async () => { const created = await request("/api/battlemap/scenes", { method: "POST", body: JSON.stringify(operation({ name })) }); await loadScenes(); setSceneId(created.id); });
  };

  const createFolder = () => {
    const name = window.prompt("Folder name");
    if (!name) return;
    mutate(async () => { await request("/api/battlemap/scene-folders", { method: "POST", body: JSON.stringify({ name }) }); await loadPreparation(); });
  };
  const toggleFavorite = (scene) => mutate(async () => {
    await request(`/api/battlemap/scenes/${scene.id}/favorite`, { method: "PUT", body: JSON.stringify({ favorite: !scene.favorite }) });
    await loadScenes();
  });

  const updateScene = (patch) => mutate(async () => {
    const updated = await request(`/api/battlemap/scenes/${state.scene.id}`, { method: "PATCH", body: JSON.stringify(operation({ revision: state.scene.revision, ...patch })) });
    setState((current) => ({ ...current, scene: updated })); await loadScenes();
  });
  const duplicateScene = () => mutate(async () => { const copy = await request(`/api/battlemap/scenes/${state.scene.id}/duplicate`, { method: "POST", headers: { "X-Operation-ID": crypto.randomUUID() } }); await loadScenes(); setSceneId(copy.id); });
  const deleteScene = () => window.confirm(`Permanently delete ${state.scene.name}?`) && mutate(async () => { await request(`/api/battlemap/scenes/${state.scene.id}`, { method: "DELETE", headers: { "X-Operation-ID": crypto.randomUUID() } }); setSceneId(null); await loadScenes(); });
  const updateSelected = (patch) => selected && mutate(() => request(`/api/battlemap/tokens/${selected.id}`, { method: "PATCH", body: JSON.stringify(operation({ revision: selected.revision, ...patch })) }));
  const updateAnnotation = (patch) => selectedAnnotation && mutate(() => request(`/api/battlemap/annotations/${selectedAnnotation.id}`, { method: "PATCH", body: JSON.stringify(operation({ revision: selectedAnnotation.revision, ...patch })) }));
  const uploadMap = (file) => {
    if (!file) return;
    const body = new FormData(); body.append("file", file);
    mutate(async () => {
      const asset = await request("/api/battlemap/assets", { method: "POST", body, headers: { "X-Operation-ID": crypto.randomUUID() } });
      await updateScene({ asset_id: asset.id, width: asset.width, height: asset.height });
    });
  };
  const uploadPortrait = (file) => {
    if (!file || !selected) return;
    const body = new FormData(); body.append("file", file);
    mutate(async () => { const asset = await request("/api/battlemap/assets", { method: "POST", body, headers: { "X-Operation-ID": crypto.randomUUID() } }); await request(`/api/battlemap/tokens/${selected.id}`, { method: "PATCH", body: JSON.stringify(operation({ revision: selected.revision, portrait_asset_id: asset.id })) }); });
  };
  const createPreset = () => {
    const kind = window.prompt("Preset kind: counter or tag", "tag");
    const name = window.prompt("Preset name");
    if (!name || !["counter", "tag"].includes(kind)) return;
    const payload = kind === "counter" ? { key: crypto.randomUUID(), label: name, value: 0 } : { key: crypto.randomUUID(), label: name };
    const isPrivate = window.confirm("Make this preset private to the DM?");
    mutate(() => request("/api/battlemap/presets", { method: "POST", body: JSON.stringify(operation({ kind, name, payload, is_private: isPrivate })) }));
  };
  const editPreset = (preset) => {
    const name = window.prompt("Preset name", preset.name);
    if (!name) return;
    const label = window.prompt("Applied label", preset.payload?.label || preset.name);
    if (!label) return;
    mutate(() => request(`/api/battlemap/presets/${preset.id}`, {
      method: "PATCH",
      body: JSON.stringify(operation({ kind: preset.kind, name, is_private: preset.is_private, payload: { ...preset.payload, label } })),
    }));
  };
  const deletePreset = (preset) => window.confirm(`Delete the ${preset.name} preset?`) && mutate(() => request(`/api/battlemap/presets/${preset.id}`, { method: "DELETE", headers: { "X-Operation-ID": crypto.randomUUID() } }));
  const applyPreset = (preset) => selected && updateSelected(preset.kind === "counter"
    ? { counters: [...(selected.counters || []), { ...preset.payload, key: crypto.randomUUID() }] }
    : { tags: [...(selected.tags || []), { ...preset.payload, key: crypto.randomUUID() }] });

  const saveCreatureTemplate = () => {
    const name = window.prompt("Creature template name", selected?.name || "Creature");
    if (!name) return;
    const armorClass = window.prompt("Armor Class (optional)", "");
    const hitPoints = window.prompt("Hit points (optional)", "");
    const details = window.prompt("Private creature/stat-block notes (optional)", "") || "";
    mutate(async () => {
      await request("/api/battlemap/creature-templates", { method: "POST", body: JSON.stringify(operation({
        name, portrait_asset_id: selected?.portrait_asset_id || null, size: selected?.size || 1,
        color: selected?.color || "#4fc3a1", default_counters: selected?.counters || [],
        default_tags: selected?.tags || [], armor_class: armorClass || null, hit_points: hitPoints || null, details,
      })) });
      await loadPreparation(); setTemplateBrowserOpen(true);
    });
  };
  const editCreatureTemplate = (template) => {
    const name = window.prompt("Template name", template.name);
    if (!name) return;
    const size = window.prompt("Size in grid squares", String(template.size));
    if (size === null) return;
    const armorClass = window.prompt("Armor Class (optional)", template.armor_class ?? "");
    if (armorClass === null) return;
    const hitPoints = window.prompt("Hit points (optional)", template.hit_points ?? "");
    if (hitPoints === null) return;
    const details = window.prompt("Private creature/stat-block notes", template.details || "");
    if (details === null) return;
    mutate(async () => {
      await request(`/api/battlemap/creature-templates/${template.id}`, { method: "PATCH", body: JSON.stringify(operation({ revision: template.revision, name, size, armor_class: armorClass || null, hit_points: hitPoints || null, details })) });
      await loadPreparation();
    });
  };
  const deleteCreatureTemplate = (template) => window.confirm(`Delete ${template.name}? Existing map tokens will not change.`) && mutate(async () => {
    await request(`/api/battlemap/creature-templates/${template.id}`, { method: "DELETE" }); await loadPreparation();
  });
  const placeCreatureTemplate = (templateId, at = null) => {
    if (!state.scene) return;
    const position = at || { x: state.scene.width / 2, y: state.scene.height / 2 };
    mutate(() => request(`/api/battlemap/creature-templates/${templateId}/place`, { method: "POST", body: JSON.stringify(operation({ scene_id: state.scene.id, ...position })) }));
  };

  const createAt = async (kind, at) => {
    if (!state.scene) return;
    if (kind === "token") {
      if (!isWarden) return;
      await request(`/api/battlemap/scenes/${state.scene.id}/tokens`, { method: "POST", body: JSON.stringify(operation({ name: "New token", x: at.x, y: at.y, owners: [] })) });
      return;
    }
    const geometry = kind === "marker" ? at
      : kind === "circle" ? { ...at, radius: state.scene.grid_size }
      : kind === "cone" ? { ...at, radius: state.scene.grid_size * 3, angle: 60, rotation: 0 }
      : kind === "line" ? { ...at, x2: at.x + state.scene.grid_size * 3, y2: at.y }
      : { ...at, width: state.scene.grid_size * 2, height: state.scene.grid_size * 2, rotation: 0 };
    await request(`/api/battlemap/scenes/${state.scene.id}/annotations`, { method: "POST", body: JSON.stringify(operation({ kind, label: kind === "marker" ? "Marker" : kind, geometry })) });
  };

  const pointerDown = (event) => {
    if (!state.scene) return;
    if (tool === "pan" || event.button === 1 || event.button === 2) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setInteraction({ type: "pan", start: point(event), view }); return;
    }
    if (event.button !== 0) return;
    const at = worldPoint(event);
    if (pendingCharacter) {
      mutate(() => request(`/api/battlemap/scenes/${state.scene.id}/tokens`, { method: "POST", body: JSON.stringify(operation({ name: pendingCharacter.name, character_id: pendingCharacter.id, owners: [pendingCharacter.id], x: at.x, y: at.y })) }));
      setPendingCharacter(null); return;
    }
    if (["token", "marker", "circle", "cone", "line", "rectangle"].includes(tool)) {
      mutate(() => createAt(tool, at)); setTool("select"); return;
    }
    if (tool === "ruler") { setInteraction({ type: "ruler", start: at, end: at }); return; }
    setSelectedId(null);
    setSelectedAnnotationId(null);
  };

  const tokenDown = (event, token) => {
    if (event.button === 2) {
      event.preventDefault(); event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      setInteraction({ type: "pan", start: point(event), view }); return;
    }
    event.stopPropagation(); setSelectedId(token.id); setSelectedAnnotationId(null);
    if (tool !== "select" || !canMove(token)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setInteraction({ type: "token", token, start: worldPoint(event), original: { x: token.x, y: token.y } });
  };

  const annotationDown = (event, item) => {
    if (event.button === 2) {
      event.preventDefault(); event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      setInteraction({ type: "pan", start: point(event), view }); return;
    }
    event.stopPropagation(); setSelectedAnnotationId(item.id); setSelectedId(null);
    if (tool !== "select" || !canEditAnnotation(item)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setInteraction({ type: "annotation", item, start: worldPoint(event), original: { ...item.geometry } });
  };

  const pointerMove = (event) => {
    if (!interaction) return;
    if (interaction.type === "pan") {
      const current = point(event);
      setView({ ...interaction.view, x: interaction.view.x + current.x - interaction.start.x, y: interaction.view.y + current.y - interaction.start.y });
    } else if (interaction.type === "ruler") {
      setInteraction({ ...interaction, end: worldPoint(event) });
    } else if (interaction.type === "token") {
      const current = worldPoint(event);
      const next = { x: interaction.original.x + current.x - interaction.start.x, y: interaction.original.y + current.y - interaction.start.y };
      setState((old) => ({ ...old, tokens: old.tokens.map((item) => item.id === interaction.token.id ? { ...item, ...next } : item) }));
    } else if (interaction.type === "annotation") {
      const current = worldPoint(event); const dx = current.x - interaction.start.x; const dy = current.y - interaction.start.y;
      const next = { ...interaction.original, x: interaction.original.x + dx, y: interaction.original.y + dy };
      if (interaction.item.kind === "line") { next.x2 = interaction.original.x2 + dx; next.y2 = interaction.original.y2 + dy; }
      setState((old) => ({ ...old, annotations: old.annotations.map((item) => item.id === interaction.item.id ? { ...item, geometry: next } : item) }));
    }
  };

  const pointerUp = (event) => {
    if (!interaction) return;
    if (interaction.type === "token") {
      const token = state.tokens.find((item) => item.id === interaction.token.id);
      const next = event.altKey ? { x: token.x, y: token.y } : snapPoint(token, state.scene);
      mutate(() => request(`/api/battlemap/tokens/${token.id}`, { method: "PATCH", body: JSON.stringify(operation({ revision: interaction.token.revision, ...next })) }));
    } else if (interaction.type === "annotation") {
      const item = state.annotations.find((value) => value.id === interaction.item.id);
      mutate(() => request(`/api/battlemap/annotations/${item.id}`, { method: "PATCH", body: JSON.stringify(operation({ revision: interaction.item.revision, geometry: item.geometry })) }));
    }
    setInteraction(null);
  };

  const sendPing = (event) => {
    if (!state.scene || event.button !== 0) return;
    event.preventDefault();
    const at = worldPoint(event);
    setPing(at); window.setTimeout(() => setPing(null), 3000);
    mutate(() => request("/api/battlemap/pings", { method: "POST", body: JSON.stringify({ scene_id: state.scene.id, x: at.x, y: at.y }) }));
  };

  const selected = state.tokens.find((item) => item.id === selectedId);
  const selectedAnnotation = state.annotations.find((item) => item.id === selectedAnnotationId);
  const grid = state.scene && state.scene.grid_visible ? {
    backgroundSize: `${state.scene.grid_size * view.zoom}px ${state.scene.grid_size * view.zoom}px`,
    backgroundPosition: `${view.x + state.scene.grid_offset_x * view.zoom}px ${view.y + state.scene.grid_offset_y * view.zoom}px`,
  } : {};
  const rulerDistance = interaction?.type === "ruler" ? euclideanDistance(interaction.start, interaction.end, state.scene) : null;
  const visibleScenes = scenes.filter((scene) => {
    const matchesName = scene.name.toLowerCase().includes(sceneSearch.trim().toLowerCase());
    const matchesFolder = sceneFolder === "all" || (sceneFolder === "unfiled" ? !scene.folder_id : scene.folder_id === Number(sceneFolder));
    return matchesName && matchesFolder && (!favoritesOnly || scene.favorite);
  });

  useEffect(() => {
    const centerTurn = (event) => {
      const token = state.tokens.find((item) => item.turn_entry_id === event.detail);
      if (!token) return;
      setSelectedId(token.id); setSelectedAnnotationId(null);
      setView((old) => ({ ...old, x: 320 - token.x * old.zoom, y: 260 - token.y * old.zoom }));
    };
    window.addEventListener("dnd-center-turn", centerTurn);
    return () => window.removeEventListener("dnd-center-turn", centerTurn);
  }, [state.tokens]);

  useEffect(() => {
    const centerCharacter = (event) => {
      const matches = state.tokens.filter((item) => item.character_id === event.detail);
      if (!matches.length) { reportError(new Error("That character is not on the scene.")); return; }
      const token = matches[0]; setSelectedId(token.id); setSelectedAnnotationId(null);
      setView((old) => ({ ...old, x: 320 - token.x * old.zoom, y: 260 - token.y * old.zoom }));
    };
    const previewScene = (event) => setSceneId(Number(event.detail));
    const placeCharacter = (event) => { setPendingCharacter(event.detail); setTool("select"); };
    window.addEventListener("dnd-center-character", centerCharacter);
    window.addEventListener("dnd-preview-scene", previewScene);
    window.addEventListener("dnd-place-character", placeCharacter);
    return () => { window.removeEventListener("dnd-center-character", centerCharacter); window.removeEventListener("dnd-preview-scene", previewScene); window.removeEventListener("dnd-place-character", placeCharacter); };
  }, [reportError, state.tokens]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") { setInteraction(null); setPendingCharacter(null); setTool("select"); }
      if (!selected || event.target.matches("input,textarea,select") || !canMove(selected)) return;
      const movement = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!movement) return;
      event.preventDefault();
      const step = event.shiftKey ? 1 : (state.scene.grid_size || 1);
      mutate(() => request(`/api/battlemap/tokens/${selected.id}`, { method: "PATCH", body: JSON.stringify(operation({ revision: selected.revision, x: selected.x + movement[0] * step, y: selected.y + movement[1] * step })) }));
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [selected, state.scene]);

  return <section className="battlemap-workspace" ref={workspaceRef}>
    <header className="battlemap-header">
      <div><p className="index">D&D shared table</p><h2>{state.scene?.name || "Battlemap"}</h2></div>
      {state.scene && <span className={`scene-visibility ${state.scene.is_active ? "live" : "preview"}`}>{state.scene.is_active ? "LIVE — visible to players" : isWarden ? "PREVIEW — DM only" : "Waiting for the DM"}</span>}
      <span className={`connection ${connected ? "online" : "offline"}`}>{pending ? "Saving" : connected ? "Synchronized" : "Reconnecting"}</span>
      <button type="button" onClick={() => document.fullscreenElement ? document.exitFullscreen() : workspaceRef.current?.requestFullscreen()}>Fullscreen</button>
      {isWarden && <button type="button" aria-expanded={sceneBrowserOpen} onClick={() => { setSceneBrowserOpen((open) => !open); setTemplateBrowserOpen(false); }}>Preparation</button>}
      {isWarden && sceneBrowserOpen && <div className="preparation-actions"><select aria-label="Scene" value={sceneId || ""} onChange={(event) => setSceneId(Number(event.target.value))}>{scenes.map((scene) => <option value={scene.id} key={scene.id}>{scene.is_active ? "★ " : ""}{scene.name}</option>)}</select><button type="button" onClick={createScene}>New scene</button>{state.scene && <button type="button" onClick={duplicateScene}>Duplicate</button>}<label className="map-upload">Upload map<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => uploadMap(event.target.files?.[0])} /></label>{state.scene && <button type="button" className="delete-record" onClick={deleteScene}>Delete scene</button>}</div>}
    </header>
    {pendingCharacter && <div className="placement-banner" role="status">Click the map to place {pendingCharacter.name}. Press Escape to cancel.</div>}
    {isWarden && sceneBrowserOpen && <nav className="preparation-nav" aria-label="Preparation tools"><button type="button" className={!templateBrowserOpen ? "primary-prep" : ""} onClick={() => setTemplateBrowserOpen(false)}>Scene library</button><button type="button" className={templateBrowserOpen ? "primary-prep" : ""} onClick={() => setTemplateBrowserOpen(true)}>Creature library</button></nav>}
    {isWarden && sceneBrowserOpen && <section className="scene-browser" aria-label="Scene browser"><header><h3>Scene browser</h3><input type="search" placeholder="Search scenes" aria-label="Search scenes" value={sceneSearch} onChange={(event) => setSceneSearch(event.target.value)} /><select aria-label="Filter by folder" value={sceneFolder} onChange={(event) => setSceneFolder(event.target.value)}><option value="all">All folders</option><option value="unfiled">Unfiled</option>{folders.map((folder) => <option value={folder.id} key={folder.id}>{folder.name} ({folder.scene_count})</option>)}</select><label><input type="checkbox" checked={favoritesOnly} onChange={(event) => setFavoritesOnly(event.target.checked)} /> Favorites</label><button type="button" onClick={createFolder}>New folder</button><button type="button" onClick={createScene}>New scene</button></header><div className="scene-grid">{visibleScenes.map((scene) => <article className={scene.id === sceneId ? "selected" : ""} key={scene.id}><button type="button" className="scene-preview" onClick={() => setSceneId(scene.id)}><AssetThumbnail assetId={scene.asset_id} request={request} alt="" /><strong>{scene.name}</strong><small>{scene.is_active ? "Live for players" : "DM preview"}</small></button><button type="button" className="favorite-button" aria-label={`${scene.favorite ? "Remove" : "Add"} ${scene.name} ${scene.favorite ? "from" : "to"} favorites`} onClick={() => toggleFavorite(scene)}>{scene.favorite ? "★" : "☆"}</button><select aria-label={`Folder for ${scene.name}`} value={scene.folder_id || ""} onChange={(event) => mutate(async () => { await request(`/api/battlemap/scenes/${scene.id}`, { method: "PATCH", body: JSON.stringify(operation({ revision: scene.revision, folder_id: event.target.value ? Number(event.target.value) : null })) }); await loadScenes(); await loadPreparation(); })}><option value="">Unfiled</option>{folders.map((folder) => <option value={folder.id} key={folder.id}>{folder.name}</option>)}</select></article>)}</div></section>}
    {isWarden && templateBrowserOpen && <section className="template-browser" aria-label="Creature template library"><header><div><h3>Creature library</h3><p>Templates are copied into independent map tokens. Later edits affect future placements only.</p></div><button type="button" onClick={saveCreatureTemplate}>{selected ? `Save ${selected.name}` : "New template"}</button></header><div className="template-grid">{templates.map((template) => <article draggable="true" onDragStart={(event) => event.dataTransfer.setData("application/x-creature-template", String(template.id))} key={template.id}><AssetThumbnail assetId={template.portrait_asset_id} request={request} alt="" /><div><strong>{template.name}</strong><small>{template.size} square{template.size === 1 ? "" : "s"}{template.armor_class != null ? ` · AC ${template.armor_class}` : ""}{template.hit_points != null ? ` · HP ${template.hit_points}` : ""}</small></div><button type="button" onClick={() => placeCreatureTemplate(template.id)}>Place</button><button type="button" onClick={() => editCreatureTemplate(template)}>Edit</button><button type="button" className="delete-record" aria-label={`Delete ${template.name}`} onClick={() => deleteCreatureTemplate(template)}>×</button></article>)}</div></section>}
    {!state.scene ? <div className="battlemap-empty-with-dock"><div className="battlemap-empty">{isWarden ? <><p>No scene exists yet.</p><button type="button" onClick={createScene}>Create first scene</button></> : <p>The DM has not activated a scene.</p>}</div>{renderDock(<p className="empty-state">Select a scene or map object to see its controls.</p>)}</div> : <div className="battlemap-layout">
      <nav className="map-tools" aria-label="Battlemap tools">{TOOLS.filter((name) => isWarden || name !== "token").map((name) => <ToolButton name={name} label={name === "pan" ? "Pan (or right-drag)" : name} active={tool === name} onClick={() => setTool(name)} key={name} />)}<div className={`shape-tool${shapeMenuOpen ? " open" : ""}`}><ToolButton name="shapes" label="Draw shapes" active={SHAPE_TOOLS.includes(tool)} onClick={() => setShapeMenuOpen((open) => !open)} /><div className="shape-tool-menu" aria-label="Shape tools">{SHAPE_TOOLS.map((name) => <ToolButton name={name} active={tool === name} onClick={() => { setTool(name); setShapeMenuOpen(false); }} key={name} />)}</div></div><span className="tool-separator" /><ToolButton name="fit" label="Fit map" onClick={fit} /><ToolButton name="reset" label="Reset view" onClick={() => setView({ x: 20, y: 20, zoom: 1 })} /><p className="map-tool-hint">Double-click to ping</p></nav>
      <div ref={stageRef} className="map-stage" style={grid} onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-creature-template")) event.preventDefault(); }} onDrop={(event) => { const templateId = Number(event.dataTransfer.getData("application/x-creature-template")); if (templateId) { event.preventDefault(); placeCreatureTemplate(templateId, screenToWorld(point(event), view)); } }}>
        <svg ref={svgRef} aria-label={`${state.scene.name} battlemap`} onContextMenu={(event) => event.preventDefault()} onDoubleClick={sendPing} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => setInteraction(null)}>
          <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
            {mapUrl ? <image href={mapUrl} width={state.scene.width} height={state.scene.height} preserveAspectRatio="none" /> : <rect className="map-background" width={state.scene.width} height={state.scene.height} />}
            <g className="map-annotations">{state.annotations.map((item) => <g className={`map-annotation${selectedAnnotationId === item.id ? " selected" : ""}`} role="button" tabIndex="0" key={item.id} aria-label={`${item.kind}: ${item.label}`} onFocus={() => { setSelectedAnnotationId(item.id); setSelectedId(null); }} onPointerDown={(event) => annotationDown(event, item)}>{annotationShape(item)}</g>)}</g>
            {interaction?.type === "ruler" && <g className="map-ruler"><line x1={interaction.start.x} y1={interaction.start.y} x2={interaction.end.x} y2={interaction.end.y} /><text x={interaction.end.x} y={interaction.end.y - 10}>{rulerDistance.toFixed(1)} {state.scene.unit_label}</text></g>}
            {[...sharedPings, ...(ping ? [{ id: "local", ...ping }] : [])].map((item) => <circle className="map-ping" cx={item.x} cy={item.y} r={state.scene.grid_size * .5} key={item.id} />)}
            <g className="map-tokens">{state.tokens.map((token) => { const size = state.scene.grid_size * token.size; const healthLabel = token.health ? `, ${token.health.hp} of ${token.health.max_hp} hit points${token.health.temp_hp ? `, ${token.health.temp_hp} temporary` : ""}` : ""; return <g className={`map-token${selectedId === token.id ? " selected" : ""}${token.locked ? " locked" : ""}`} role="button" tabIndex="0" aria-label={`${token.name}${token.locked ? ", locked" : ""}${healthLabel}`} transform={`translate(${token.x} ${token.y})`} onFocus={() => { setSelectedId(token.id); setSelectedAnnotationId(null); }} onPointerDown={(event) => tokenDown(event, token)} key={token.id}><TokenVisual token={token} size={size} request={request} /><circle className="token-outline" r={size / 2} fill="none" />{token.health && <g className="token-health"><rect x={-size / 2} y={size / 2 + 3} width={size} height="5" /><rect x={-size / 2} y={size / 2 + 3} width={size * Math.max(0, Math.min(1, token.health.hp / token.health.max_hp))} height="5" /></g>}<text y={size / 2 + 20} textAnchor="middle">{token.name}</text>{token.tags?.map((tag, index) => <text className="token-tag" x={size / 2} y={-size / 2 + index * 13} key={tag.key || tag.label}>{tag.icon || tag.label}</text>)}</g>; })}</g>
          </g>
        </svg>
      </div>
      {renderDock(<div className="inspector-content"><div className="inspector-actions"><button type="button" onClick={() => mutate(() => request("/api/battlemap/undo", { method: "POST" }))}>Undo</button>{selected && isWarden && <button type="button" className="delete-record" onClick={() => window.confirm(`Remove ${selected.name}?`) && mutate(async () => { await request(`/api/battlemap/tokens/${selected.id}`, { method: "DELETE", headers: { "X-Operation-ID": crypto.randomUUID() } }); setSelectedId(null); })}>Delete</button>}{selectedAnnotation && canEditAnnotation(selectedAnnotation) && <button type="button" className="delete-record" onClick={() => window.confirm(`Remove ${selectedAnnotation.label}?`) && mutate(async () => { await request(`/api/battlemap/annotations/${selectedAnnotation.id}`, { method: "DELETE", headers: { "X-Operation-ID": crypto.randomUUID() } }); setSelectedAnnotationId(null); })}>Delete</button>}</div><h3>{selected ? selected.name : selectedAnnotation ? selectedAnnotation.label : "Scene controls"}</h3>{selected ? <>
        <label>X<input type="number" value={Math.round(selected.x)} onChange={(event) => setState((old) => ({ ...old, tokens: old.tokens.map((item) => item.id === selected.id ? { ...item, x: Number(event.target.value) } : item) }))} onBlur={() => updateSelected({ x: selected.x })} /></label>
        <label>Y<input type="number" value={Math.round(selected.y)} onChange={(event) => setState((old) => ({ ...old, tokens: old.tokens.map((item) => item.id === selected.id ? { ...item, y: Number(event.target.value) } : item) }))} onBlur={() => updateSelected({ y: selected.y })} /></label>
        <label>Size (grid squares)<input type="number" min="0.25" max="10" step="0.25" value={selected.size} onChange={(event) => setState((old) => ({ ...old, tokens: old.tokens.map((item) => item.id === selected.id ? { ...item, size: Number(event.target.value) } : item) }))} onBlur={() => updateSelected({ size: selected.size })} /></label>
        <label>Color<input type="color" value={selected.color} onChange={(event) => updateSelected({ color: event.target.value })} /></label>
        {selected.health && <p className="token-health-readout">HP {selected.health.hp}/{selected.health.max_hp}{selected.health.temp_hp ? ` + ${selected.health.temp_hp} temp` : ""}</p>}
        <label>Apply 2024 condition<select value="" onChange={(event) => { const label = event.target.value; if (label && !selected.tags.some((tag) => tag.condition === label)) updateSelected({ tags: [...selected.tags, { key: `condition-${label.toLowerCase()}`, label, condition: label }] }); }}><option value="">Choose condition…</option>{DND_CONDITIONS.map((condition) => <option key={condition}>{condition}</option>)}</select></label>
        {isWarden && <><label>Name<input value={selected.name} onChange={(event) => setState((old) => ({ ...old, tokens: old.tokens.map((item) => item.id === selected.id ? { ...item, name: event.target.value } : item) }))} onBlur={() => updateSelected({ name: selected.name })} /></label><label className="map-upload">Upload portrait<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => uploadPortrait(event.target.files?.[0])} /></label><label>Character resource link<select value={selected.character_id || ""} onChange={(event) => updateSelected({ character_id: event.target.value ? Number(event.target.value) : null })}><option value="">Independent NPC resources</option>{dashboard.characters.map((character) => <option value={character.id} key={character.id}>{character.name}</option>)}</select></label><label>Turn-order link<select value={selected.turn_entry_id || ""} onChange={(event) => updateSelected({ turn_entry_id: event.target.value ? Number(event.target.value) : null })}><option value="">None</option>{dashboard.turn_order.map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}</select></label><label><input type="checkbox" checked={selected.locked} onChange={(event) => updateSelected({ locked: event.target.checked })} /> Locked</label><label><input type="checkbox" checked={selected.hidden} onChange={(event) => updateSelected({ hidden: event.target.checked })} /> Hidden from players</label><fieldset><legend>Owners</legend>{dashboard.characters.map((character) => <label key={character.id}><input type="checkbox" checked={selected.owners.includes(character.id)} onChange={(event) => updateSelected({ owners: event.target.checked ? [...selected.owners, character.id] : selected.owners.filter((id) => id !== character.id) })} /> {character.name}</label>)}</fieldset></>}
        <div className="counter-list">{selected.counters?.map((counter) => <div key={counter.key}><span>{counter.label}</span><button type="button" onClick={() => mutate(() => request(`/api/battlemap/tokens/${selected.id}/counters/${counter.key}/delta`, { method: "POST", body: JSON.stringify({ revision: selected.revision, delta: -1, operation_id: crypto.randomUUID() }) }))}>−</button><b>{counter.value}</b><button type="button" onClick={() => mutate(() => request(`/api/battlemap/tokens/${selected.id}/counters/${counter.key}/delta`, { method: "POST", body: JSON.stringify({ revision: selected.revision, delta: 1, operation_id: crypto.randomUUID() }) }))}>+</button></div>)}</div>
        <div className="token-condition-list">{selected.tags?.map((tag) => <span key={tag.key || tag.label}>{tag.label}<button type="button" aria-label={`Remove ${tag.label}`} onClick={() => updateSelected({ tags: selected.tags.filter((item) => item !== tag) })}>×</button></span>)}</div>
        <button type="button" onClick={() => { const label = window.prompt("Counter label"); if (label) updateSelected({ counters: [...(selected.counters || []), { key: crypto.randomUUID(), label, value: 0 }] }); }}>Add counter</button><button type="button" onClick={() => { const label = window.prompt("Tag label"); if (label) updateSelected({ tags: [...(selected.tags || []), { key: crypto.randomUUID(), label }] }); }}>Add tag</button><section className="preset-list"><h4>Presets</h4>{state.presets.map((preset) => <div key={preset.id}><button type="button" onClick={() => applyPreset(preset)}>Apply {preset.name}</button>{isWarden && <><button type="button" aria-label={`Edit ${preset.name} preset`} onClick={() => editPreset(preset)}>Edit</button><button type="button" aria-label={`Delete ${preset.name} preset`} onClick={() => deletePreset(preset)}>×</button></>}</div>)}{isWarden && <button type="button" onClick={createPreset}>New preset</button>}</section>
      </> : selectedAnnotation ? <>{["x", "y", ...(selectedAnnotation.kind === "circle" ? ["radius"] : selectedAnnotation.kind === "cone" ? ["radius", "angle", "rotation"] : selectedAnnotation.kind === "line" ? ["x2", "y2"] : selectedAnnotation.kind === "rectangle" ? ["width", "height", "rotation"] : [])].map((key) => <label key={key}>{key}<input type="number" disabled={!canEditAnnotation(selectedAnnotation)} value={Math.round(selectedAnnotation.geometry[key] || 0)} onChange={(event) => setState((old) => ({ ...old, annotations: old.annotations.map((item) => item.id === selectedAnnotation.id ? { ...item, geometry: { ...item.geometry, [key]: Number(event.target.value) } } : item) }))} onBlur={() => updateAnnotation({ geometry: selectedAnnotation.geometry })} /></label>)}<label>Label<input disabled={!canEditAnnotation(selectedAnnotation)} value={selectedAnnotation.label} onChange={(event) => setState((old) => ({ ...old, annotations: old.annotations.map((item) => item.id === selectedAnnotation.id ? { ...item, label: event.target.value } : item) }))} onBlur={() => updateAnnotation({ label: selectedAnnotation.label })} /></label>{isWarden && <><label><input type="checkbox" checked={selectedAnnotation.locked} onChange={(event) => updateAnnotation({ locked: event.target.checked })} /> Locked</label><label><input type="checkbox" checked={selectedAnnotation.hidden} onChange={(event) => updateAnnotation({ hidden: event.target.checked })} /> Hidden</label></>}</> : isWarden ? <><label>Scene name<input value={state.scene.name} onChange={(event) => setState((old) => ({ ...old, scene: { ...old.scene, name: event.target.value } }))} onBlur={() => updateScene({ name: state.scene.name })} /></label>{[["Grid size","grid_size"],["Grid offset X","grid_offset_x"],["Grid offset Y","grid_offset_y"],["Units/square","units_per_square"]].map(([label, key]) => <label key={key}>{label}<input type="number" min={key === "grid_size" ? 5 : undefined} value={state.scene[key]} onChange={(event) => setState((old) => ({ ...old, scene: { ...old.scene, [key]: Number(event.target.value) } }))} onBlur={() => updateScene({ [key]: state.scene[key] })} /></label>)}<label>Unit label<input value={state.scene.unit_label} onChange={(event) => setState((old) => ({ ...old, scene: { ...old.scene, unit_label: event.target.value } }))} onBlur={() => updateScene({ unit_label: state.scene.unit_label })} /></label><label><input type="checkbox" checked={state.scene.grid_visible} onChange={(event) => updateScene({ grid_visible: event.target.checked })} /> Show grid</label><label><input type="checkbox" checked={state.scene.snap_enabled} onChange={(event) => updateScene({ snap_enabled: event.target.checked })} /> Snap to grid</label></> : <p>Select your token or choose a map tool.</p>}</div>)}
    </div>}
  </section>;
}
