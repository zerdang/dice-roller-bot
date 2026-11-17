import { useCallback, useEffect, useRef, useState } from "react";
import { annotationBounds, boundsIntersect, conePath, euclideanDistance, normalizedRect, screenToWorld, snapPoint, tokenBounds, zoomAt } from "./battlemapGeometry.js";

const TOOLS = ["select", "pan", "token", "marker", "ruler"];
const SHAPE_TOOLS = ["circle", "cone", "line", "rectangle"];
const DND_CONDITIONS = ["Blinded", "Charmed", "Deafened", "Frightened", "Grappled", "Incapacitated", "Invisible", "Paralyzed", "Petrified", "Poisoned", "Prone", "Restrained", "Stunned", "Unconscious"];
const ABILITIES = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];
const d20 = (modifier = 0) => `1d20${Number(modifier) >= 0 ? "+" : ""}${Number(modifier) || 0}`;

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

export default function Battlemap({ dashboard, request, refreshDashboard, reportError, renderDock }) {
  const [sceneId, setSceneId] = useState(null);
  const [state, setState] = useState({ scene: null, tokens: [], annotations: [], presets: [] });
  const [tool, setTool] = useState("select");
  const [selectedTokenIds, setSelectedTokenIds] = useState([]);
  const [selectedAnnotationIds, setSelectedAnnotationIds] = useState([]);
  const [view, setView] = useState({ x: 20, y: 20, zoom: 1 });
  const [interaction, setInteraction] = useState(null);
  const [pending, setPending] = useState(false);
  const [connected, setConnected] = useState(true);
  const [ping, setPing] = useState(null);
  const [sharedPings, setSharedPings] = useState([]);
  const [mapUrl, setMapUrl] = useState("");
  const [templates, setTemplates] = useState([]);
  const [sceneBrowserOpen, setSceneBrowserOpen] = useState(false);
  const [pendingCharacter, setPendingCharacter] = useState(null);
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
  const [headerExpanded, setHeaderExpanded] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const svgRef = useRef(null);
  const stageRef = useRef(null);
  const workspaceRef = useRef(null);
  const clipboardRef = useRef([]);
  const pasteCountRef = useRef(0);
  const isWarden = dashboard.role === "warden";
  const playerId = dashboard.characters?.[0]?.id;
  const selectedId = selectedTokenIds.at(-1) ?? null;
  const selectedAnnotationId = selectedAnnotationIds.at(-1) ?? null;
  const setSelectedId = (value) => setSelectedTokenIds(value == null ? [] : [value]);
  const setSelectedAnnotationId = (value) => setSelectedAnnotationIds(value == null ? [] : [value]);

  const loadScenes = useCallback(async () => {
    const list = await request("/api/battlemap/scenes");
    setSceneId((current) => current && list.some((item) => item.id === current) ? current : list.find((item) => item.is_active)?.id || list[0]?.id || null);
  }, [request]);

  const loadPreparation = useCallback(async () => {
    if (!isWarden) return;
    setTemplates(await request("/api/battlemap/creature-templates"));
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
    const reloadSceneLibrary = () => { loadScenes().catch(reportError); loadPreparation().catch(reportError); };
    window.addEventListener("dnd-scenes-changed", reloadSceneLibrary);
    return () => window.removeEventListener("dnd-scenes-changed", reloadSceneLibrary);
  }, [loadPreparation, loadScenes, reportError]);
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
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !window.ResizeObserver) return undefined;
    let previous = { width: stage.clientWidth, height: stage.clientHeight };
    const observer = new ResizeObserver(() => {
      const next = { width: stage.clientWidth, height: stage.clientHeight };
      if (next.width && next.height && previous.width && previous.height) {
        const dx = (next.width - previous.width) / 2;
        const dy = (next.height - previous.height) / 2;
        if (dx || dy) setView(current => ({ ...current, x: current.x + dx, y: current.y + dy }));
      }
      previous = next;
    });
    observer.observe(stage);
    return () => observer.disconnect();
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

  const updateScene = (patch) => mutate(async () => {
    const updated = await request(`/api/battlemap/scenes/${state.scene.id}`, { method: "PATCH", body: JSON.stringify(operation({ revision: state.scene.revision, ...patch })) });
    setState((current) => ({ ...current, scene: updated })); await loadScenes();
  });
  const updateSelected = (patch) => selected && mutate(() => request(`/api/battlemap/tokens/${selected.id}`, { method: "PATCH", body: JSON.stringify(operation({ revision: selected.revision, ...patch })) }));
  const updateAnnotation = (patch) => selectedAnnotation && mutate(() => request(`/api/battlemap/annotations/${selectedAnnotation.id}`, { method: "PATCH", body: JSON.stringify(operation({ revision: selectedAnnotation.revision, ...patch })) }));
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
    setContextMenu(null);
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
    if (tool === "select") {
      event.currentTarget.setPointerCapture(event.pointerId);
      setInteraction({ type: "marquee", start: at, end: at, additive: event.shiftKey, tokenIds: selectedTokenIds, annotationIds: selectedAnnotationIds });
    }
  };

  const tokenDown = (event, token) => {
    if (event.button === 2) {
      event.preventDefault(); event.stopPropagation();
      if (!selectedTokenIds.includes(token.id)) { setSelectedTokenIds([token.id]); setSelectedAnnotationIds([]); }
      const rect = stageRef.current?.getBoundingClientRect();
      const rawX = event.clientX - (rect?.left || 0); const rawY = event.clientY - (rect?.top || 0);
      setContextMenu({ tokenId: token.id, x: Math.max(8, Math.min(rawX, (rect?.width || rawX + 256) - 256)), y: Math.max(8, Math.min(rawY, (rect?.height || rawY + 390) - 390)) });
      return;
    }
    event.stopPropagation(); setContextMenu(null);
    if (event.shiftKey) {
      setSelectedTokenIds((ids) => ids.includes(token.id) ? ids.filter((id) => id !== token.id) : [...ids, token.id]);
      return;
    }
    const tokenIds = selectedTokenIds.includes(token.id) ? selectedTokenIds : [token.id];
    const annotationIds = selectedTokenIds.includes(token.id) ? selectedAnnotationIds : [];
    setSelectedTokenIds(tokenIds); setSelectedAnnotationIds(annotationIds);
    if (tool !== "select" || !canMove(token)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setInteraction({
      type: "selection", start: worldPoint(event),
      tokens: state.tokens.filter((item) => tokenIds.includes(item.id) && canMove(item)).map((item) => ({ ...item, original: { x: item.x, y: item.y } })),
      annotations: state.annotations.filter((item) => annotationIds.includes(item.id) && canEditAnnotation(item)).map((item) => ({ ...item, original: { ...item.geometry } })),
    });
  };

  const annotationDown = (event, item) => {
    if (event.button === 2) {
      event.preventDefault(); event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      setInteraction({ type: "pan", start: point(event), view }); return;
    }
    event.stopPropagation(); setContextMenu(null);
    if (event.shiftKey) {
      setSelectedAnnotationIds((ids) => ids.includes(item.id) ? ids.filter((id) => id !== item.id) : [...ids, item.id]);
      return;
    }
    const annotationIds = selectedAnnotationIds.includes(item.id) ? selectedAnnotationIds : [item.id];
    const tokenIds = selectedAnnotationIds.includes(item.id) ? selectedTokenIds : [];
    setSelectedAnnotationIds(annotationIds); setSelectedTokenIds(tokenIds);
    if (tool !== "select" || !canEditAnnotation(item)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setInteraction({
      type: "selection", start: worldPoint(event),
      tokens: state.tokens.filter((token) => tokenIds.includes(token.id) && canMove(token)).map((token) => ({ ...token, original: { x: token.x, y: token.y } })),
      annotations: state.annotations.filter((annotation) => annotationIds.includes(annotation.id) && canEditAnnotation(annotation)).map((annotation) => ({ ...annotation, original: { ...annotation.geometry } })),
    });
  };

  const pointerMove = (event) => {
    if (!interaction) return;
    if (interaction.type === "pan") {
      const current = point(event);
      setView({ ...interaction.view, x: interaction.view.x + current.x - interaction.start.x, y: interaction.view.y + current.y - interaction.start.y });
    } else if (interaction.type === "ruler") {
      setInteraction({ ...interaction, end: worldPoint(event) });
    } else if (interaction.type === "marquee") {
      setInteraction({ ...interaction, end: worldPoint(event) });
    } else if (interaction.type === "selection") {
      const current = worldPoint(event); const dx = current.x - interaction.start.x; const dy = current.y - interaction.start.y;
      const tokens = new Map(interaction.tokens.map((item) => [item.id, { x: item.original.x + dx, y: item.original.y + dy }]));
      const annotations = new Map(interaction.annotations.map((item) => {
        const geometry = { ...item.original, x: item.original.x + dx, y: item.original.y + dy };
        if (item.kind === "line") { geometry.x2 = item.original.x2 + dx; geometry.y2 = item.original.y2 + dy; }
        return [item.id, geometry];
      }));
      setState((old) => ({
        ...old,
        tokens: old.tokens.map((item) => tokens.has(item.id) ? { ...item, ...tokens.get(item.id) } : item),
        annotations: old.annotations.map((item) => annotations.has(item.id) ? { ...item, geometry: annotations.get(item.id) } : item),
      }));
    }
  };

  const pointerUp = (event) => {
    if (!interaction) return;
    if (interaction.type === "marquee") {
      const rectangle = normalizedRect(interaction.start, interaction.end);
      const dragged = rectangle.width > 3 / view.zoom || rectangle.height > 3 / view.zoom;
      const tokenIds = dragged ? state.tokens.filter((item) => canMove(item) && boundsIntersect(rectangle, tokenBounds(item, state.scene.grid_size))).map((item) => item.id) : [];
      const annotationIds = dragged ? state.annotations.filter((item) => canEditAnnotation(item) && boundsIntersect(rectangle, annotationBounds(item))).map((item) => item.id) : [];
      setSelectedTokenIds(interaction.additive ? [...new Set([...interaction.tokenIds, ...tokenIds])] : tokenIds);
      setSelectedAnnotationIds(interaction.additive ? [...new Set([...interaction.annotationIds, ...annotationIds])] : annotationIds);
    } else if (interaction.type === "selection") {
      const tokenChanges = interaction.tokens.map((original) => {
        const token = state.tokens.find((item) => item.id === original.id);
        const next = event.altKey ? { x: token.x, y: token.y } : snapPoint(token, state.scene);
        return request(`/api/battlemap/tokens/${token.id}`, { method: "PATCH", body: JSON.stringify(operation({ revision: original.revision, ...next })) });
      });
      const annotationChanges = interaction.annotations.map((original) => {
        const item = state.annotations.find((value) => value.id === original.id);
        return request(`/api/battlemap/annotations/${item.id}`, { method: "PATCH", body: JSON.stringify(operation({ revision: original.revision, geometry: item.geometry })) });
      });
      if (tokenChanges.length || annotationChanges.length) mutate(() => Promise.all([...tokenChanges, ...annotationChanges]));
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
  const selectedTokens = state.tokens.filter((item) => selectedTokenIds.includes(item.id));
  const selectedAnnotations = state.annotations.filter((item) => selectedAnnotationIds.includes(item.id));
  const contextToken = state.tokens.find((item) => item.id === contextMenu?.tokenId);
  const contextCharacter = dashboard.dnd_characters?.find((item) => item.id === contextToken?.character_id);
  const canRollContext = Boolean(contextToken?.character_id && (isWarden || contextToken.character_id === playerId));
  const rulerDistance = interaction?.type === "ruler" ? euclideanDistance(interaction.start, interaction.end, state.scene) : null;

  const copySelection = (tokenIds = selectedTokenIds, annotationIds = selectedAnnotationIds) => {
    const tokens = state.tokens.filter((item) => tokenIds.includes(item.id)).map((item) => ({
      type: "token",
      payload: Object.fromEntries(["name", "kind", "x", "y", "size", "color", "portrait_asset_id", "character_id", "owners", "locked", "hidden", "counters", "tags", "turn_entry_id"].map((key) => [key, item[key]])),
    }));
    const annotations = state.annotations.filter((item) => annotationIds.includes(item.id)).map((item) => ({
      type: "annotation",
      payload: Object.fromEntries(["kind", "label", "geometry", "color", "opacity", "icon", "locked", "hidden"].map((key) => [key, item[key]])),
    }));
    clipboardRef.current = [...tokens, ...annotations];
    pasteCountRef.current = 0;
    return clipboardRef.current.length > 0;
  };

  const deleteSelection = async (tokenIds = selectedTokenIds, annotationIds = selectedAnnotationIds) => {
    const tokens = state.tokens.filter((item) => tokenIds.includes(item.id) && isWarden);
    const annotations = state.annotations.filter((item) => annotationIds.includes(item.id) && canEditAnnotation(item));
    if (!tokens.length && !annotations.length) return false;
    await mutate(async () => {
      await Promise.all([
        ...tokens.map((item) => request(`/api/battlemap/tokens/${item.id}`, { method: "DELETE", headers: { "X-Operation-ID": crypto.randomUUID() } })),
        ...annotations.map((item) => request(`/api/battlemap/annotations/${item.id}`, { method: "DELETE", headers: { "X-Operation-ID": crypto.randomUUID() } })),
      ]);
    });
    setSelectedTokenIds((ids) => ids.filter((id) => !tokens.some((item) => item.id === id)));
    setSelectedAnnotationIds((ids) => ids.filter((id) => !annotations.some((item) => item.id === id)));
    setContextMenu(null);
    return true;
  };

  const cutSelection = () => {
    const tokenIds = isWarden ? selectedTokenIds : [];
    const annotationIds = selectedAnnotations.filter(canEditAnnotation).map((item) => item.id);
    if (!copySelection(tokenIds, annotationIds)) return false;
    deleteSelection(tokenIds, annotationIds);
    return true;
  };

  const pasteSelection = async () => {
    if (!state.scene || !clipboardRef.current.length) return false;
    pasteCountRef.current += 1;
    const offset = (state.scene.grid_size || 20) * .5 * pasteCountRef.current;
    const entries = clipboardRef.current.filter((entry) => entry.type !== "token" || isWarden || entry.payload.character_id === playerId);
    if (!entries.length) return false;
    let created = [];
    await mutate(async () => {
      created = await Promise.all(entries.map((entry) => {
        if (entry.type === "token") {
          return request(`/api/battlemap/scenes/${state.scene.id}/tokens`, { method: "POST", body: JSON.stringify(operation({ ...entry.payload, x: entry.payload.x + offset, y: entry.payload.y + offset })) }).then((item) => ({ type: "token", item }));
        }
        const geometry = { ...entry.payload.geometry, x: entry.payload.geometry.x + offset, y: entry.payload.geometry.y + offset };
        if (entry.payload.kind === "line") { geometry.x2 += offset; geometry.y2 += offset; }
        return request(`/api/battlemap/scenes/${state.scene.id}/annotations`, { method: "POST", body: JSON.stringify(operation({ ...entry.payload, geometry })) }).then((item) => ({ type: "annotation", item }));
      }));
    });
    setSelectedTokenIds(created.filter((entry) => entry.type === "token").map((entry) => entry.item.id));
    setSelectedAnnotationIds(created.filter((entry) => entry.type === "annotation").map((entry) => entry.item.id));
    return true;
  };

  const moveSelectionBy = (dx, dy) => {
    const tokens = selectedTokens.filter(canMove);
    const annotations = selectedAnnotations.filter(canEditAnnotation);
    if (!tokens.length && !annotations.length) return false;
    mutate(() => Promise.all([
      ...tokens.map((item) => request(`/api/battlemap/tokens/${item.id}`, { method: "PATCH", body: JSON.stringify(operation({ revision: item.revision, x: item.x + dx, y: item.y + dy })) })),
      ...annotations.map((item) => {
        const geometry = { ...item.geometry, x: item.geometry.x + dx, y: item.geometry.y + dy };
        if (item.kind === "line") { geometry.x2 += dx; geometry.y2 += dy; }
        return request(`/api/battlemap/annotations/${item.id}`, { method: "PATCH", body: JSON.stringify(operation({ revision: item.revision, geometry })) });
      }),
    ]));
    return true;
  };

  const rollFromToken = async (token, label, expression) => {
    if (!token?.character_id) return;
    setPending(true);
    try {
      await request(`/api/dnd/characters/${token.character_id}/rolls`, { method: "POST", body: JSON.stringify({ kind: "custom", label, expression, mode: "normal", audience: "public", operation_id: crypto.randomUUID() }) });
      await refreshDashboard?.(true);
      setContextMenu(null);
    } catch (error) { reportError(error); }
    finally { setPending(false); }
  };

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
      if (event.key === "Escape") { setInteraction(null); setPendingCharacter(null); setContextMenu(null); setTool("select"); }
      if (event.target instanceof HTMLElement && (event.target.matches("input,textarea,select") || event.target.isContentEditable)) return;
      const shortcut = event.ctrlKey || event.metaKey;
      if (shortcut && event.key.toLowerCase() === "c") {
        if (copySelection()) event.preventDefault();
        return;
      }
      if (shortcut && event.key.toLowerCase() === "x") {
        if (cutSelection()) event.preventDefault();
        return;
      }
      if (shortcut && event.key.toLowerCase() === "v") {
        if (clipboardRef.current.length) { event.preventDefault(); pasteSelection(); }
        return;
      }
      if (["Delete", "Backspace"].includes(event.key)) {
        if (selectedTokenIds.length || selectedAnnotationIds.length) { event.preventDefault(); deleteSelection(); }
        return;
      }
      const movement = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!movement) return;
      event.preventDefault();
      const step = event.shiftKey ? 1 : (state.scene.grid_size || 1);
      moveSelectionBy(movement[0] * step, movement[1] * step);
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [selectedTokenIds, selectedAnnotationIds, selectedTokens, selectedAnnotations, state.scene]);

  return <section className="battlemap-workspace" ref={workspaceRef}>
    <header className={`battlemap-header${headerExpanded || sceneBrowserOpen ? " expanded" : " compact"}`}>
      <div className="compact-table-title"><h2>{dashboard.campaign?.name || "Campaign"}</h2><span>{state.scene?.name || "No active scene"}</span></div>
      {state.scene && <span className={`scene-visibility ${state.scene.is_active ? "live" : "preview"}`}>{state.scene.is_active ? "LIVE — visible to players" : isWarden ? "PREVIEW — DM only" : "Waiting for the DM"}</span>}
      <span className={`connection ${connected ? "online" : "offline"}`}>{pending ? "Saving" : connected ? "Synchronized" : "Reconnecting"}</span>
      {isWarden && <button type="button" onClick={() => window.dispatchEvent(new Event("dnd-open-scenes"))}>Scenes</button>}
      <button type="button" className="header-expand" aria-expanded={headerExpanded || sceneBrowserOpen} onClick={() => {
        if (headerExpanded || sceneBrowserOpen) {
          setHeaderExpanded(false);
          setSceneBrowserOpen(false);
        } else setHeaderExpanded(true);
      }}>{headerExpanded || sceneBrowserOpen ? "Hide controls" : "Controls"}</button>
      {(headerExpanded || sceneBrowserOpen) && <button type="button" onClick={() => document.fullscreenElement ? document.exitFullscreen() : workspaceRef.current?.requestFullscreen()}>Fullscreen</button>}
      {isWarden && (headerExpanded || sceneBrowserOpen) && <button type="button" aria-expanded={sceneBrowserOpen} onClick={() => setSceneBrowserOpen(open => !open)}>Creatures</button>}
    </header>
    {pendingCharacter && <div className="placement-banner" role="status">Click the map to place {pendingCharacter.name}. Press Escape to cancel.</div>}
    {isWarden && sceneBrowserOpen && <section className="template-browser" aria-label="Creature template library"><header><div><h3>Creature library</h3><p>Templates are copied into independent map tokens. Later edits affect future placements only.</p></div><button type="button" onClick={saveCreatureTemplate}>{selected ? `Save ${selected.name}` : "New template"}</button></header><div className="template-grid">{templates.map((template) => <article draggable="true" onDragStart={(event) => event.dataTransfer.setData("application/x-creature-template", String(template.id))} key={template.id}><AssetThumbnail assetId={template.portrait_asset_id} request={request} alt="" /><div><strong>{template.name}</strong><small>{template.size} square{template.size === 1 ? "" : "s"}{template.armor_class != null ? ` · AC ${template.armor_class}` : ""}{template.hit_points != null ? ` · HP ${template.hit_points}` : ""}</small></div><button type="button" onClick={() => placeCreatureTemplate(template.id)}>Place</button><button type="button" onClick={() => editCreatureTemplate(template)}>Edit</button><button type="button" className="delete-record" aria-label={`Delete ${template.name}`} onClick={() => deleteCreatureTemplate(template)}>×</button></article>)}</div></section>}
    {!state.scene ? <div className="battlemap-empty-with-dock"><div className="battlemap-empty">{isWarden ? <><p>No scene exists yet.</p><button type="button" onClick={() => window.dispatchEvent(new Event("dnd-open-scenes"))}>Create first scene</button></> : <p>The DM has not activated a scene.</p>}</div>{renderDock(<p className="empty-state">Select a scene or map object to see its controls.</p>, { sceneId })}</div> : <div className="battlemap-layout">
      <nav className="map-tools" aria-label="Battlemap tools">{TOOLS.filter((name) => isWarden || name !== "token").map((name) => <ToolButton name={name} label={name === "pan" ? "Pan (or right-drag)" : name} active={tool === name} onClick={() => setTool(name)} key={name} />)}<div className={`shape-tool${shapeMenuOpen ? " open" : ""}`}><ToolButton name="shapes" label="Draw shapes" active={SHAPE_TOOLS.includes(tool)} onClick={() => setShapeMenuOpen((open) => !open)} /><div className="shape-tool-menu" aria-label="Shape tools">{SHAPE_TOOLS.map((name) => <ToolButton name={name} active={tool === name} onClick={() => { setTool(name); setShapeMenuOpen(false); }} key={name} />)}</div></div><span className="tool-separator" /><ToolButton name="fit" label="Fit map" onClick={fit} /><ToolButton name="reset" label="Reset view" onClick={() => setView({ x: 20, y: 20, zoom: 1 })} /><p className="map-tool-hint">Drag select<br />Ctrl C/V · Del<br />Double-click ping</p></nav>
      <div ref={stageRef} className="map-stage" onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-creature-template")) event.preventDefault(); }} onDrop={(event) => { const templateId = Number(event.dataTransfer.getData("application/x-creature-template")); if (templateId) { event.preventDefault(); placeCreatureTemplate(templateId, screenToWorld(point(event), view)); } }}>
        <svg ref={svgRef} aria-label={`${state.scene.name} battlemap`} onContextMenu={(event) => event.preventDefault()} onDoubleClick={sendPing} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => setInteraction(null)}>
          <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
            <defs><pattern id={`battle-grid-${state.scene.id}`} x={state.scene.grid_offset_x} y={state.scene.grid_offset_y} width={state.scene.grid_size} height={state.scene.grid_size} patternUnits="userSpaceOnUse"><path d={`M ${state.scene.grid_size} 0 L 0 0 0 ${state.scene.grid_size}`} /></pattern></defs>
            {mapUrl ? <image href={mapUrl} width={state.scene.width} height={state.scene.height} preserveAspectRatio="none" /> : <rect className="map-background" width={state.scene.width} height={state.scene.height} />}
            {state.scene.grid_visible && <rect className="map-grid-overlay" width={state.scene.width} height={state.scene.height} fill={`url(#battle-grid-${state.scene.id})`} />}
            <g className="map-annotations">{state.annotations.map((item) => <g className={`map-annotation${selectedAnnotationIds.includes(item.id) ? " selected" : ""}`} role="button" tabIndex="0" key={item.id} aria-label={`${item.kind}: ${item.label}`} onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) { setSelectedAnnotationId(item.id); setSelectedId(null); } }} onPointerDown={(event) => annotationDown(event, item)}>{annotationShape(item)}</g>)}</g>
            {interaction?.type === "ruler" && <g className="map-ruler"><line x1={interaction.start.x} y1={interaction.start.y} x2={interaction.end.x} y2={interaction.end.y} /><text x={interaction.end.x} y={interaction.end.y - 10}>{rulerDistance.toFixed(1)} {state.scene.unit_label}</text></g>}
            {[...sharedPings, ...(ping ? [{ id: "local", ...ping }] : [])].map((item) => <circle className="map-ping" cx={item.x} cy={item.y} r={state.scene.grid_size * .5} key={item.id} />)}
            <g className="map-tokens">{state.tokens.map((token) => { const size = state.scene.grid_size * token.size; const healthLabel = token.health ? `, ${token.health.hp} of ${token.health.max_hp} hit points${token.health.temp_hp ? `, ${token.health.temp_hp} temporary` : ""}` : ""; return <g className={`map-token${selectedTokenIds.includes(token.id) ? " selected" : ""}${token.locked ? " locked" : ""}`} role="button" tabIndex="0" aria-label={`${token.name}${token.locked ? ", locked" : ""}${healthLabel}`} transform={`translate(${token.x} ${token.y})`} onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) { setSelectedId(token.id); setSelectedAnnotationId(null); } }} onPointerDown={(event) => tokenDown(event, token)} key={token.id}><TokenVisual token={token} size={size} request={request} /><circle className="token-outline" r={size / 2} fill="none" />{token.health && <g className="token-health"><rect x={-size / 2} y={size / 2 + 3} width={size} height="5" /><rect x={-size / 2} y={size / 2 + 3} width={size * Math.max(0, Math.min(1, token.health.hp / token.health.max_hp))} height="5" /></g>}<text y={size / 2 + 20} textAnchor="middle">{token.name}</text>{token.tags?.map((tag, index) => <text className="token-tag" x={size / 2} y={-size / 2 + index * 13} key={tag.key || tag.label}>{tag.icon || tag.label}</text>)}</g>; })}</g>
            {interaction?.type === "marquee" && <rect className="map-selection-marquee" {...normalizedRect(interaction.start, interaction.end)} />}
          </g>
        </svg>
        {contextMenu && contextToken && <div className="token-context-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>
          <strong>{contextToken.name}</strong>
          <button type="button" role="menuitem" onClick={() => { copySelection([contextToken.id], []); setContextMenu(null); }}>Copy <kbd>Ctrl C</kbd></button>
          {isWarden && <button type="button" role="menuitem" onClick={() => { copySelection([contextToken.id], []); deleteSelection([contextToken.id], []); }}>Cut <kbd>Ctrl X</kbd></button>}
          {isWarden && <button type="button" role="menuitem" className="danger" onClick={() => deleteSelection([contextToken.id], [])}>Delete <kbd>Del</kbd></button>}
          {canRollContext && <section className="token-roll-menu"><span>Public rolls</span><div>
            <button type="button" onClick={() => rollFromToken(contextToken, "d20 roll", "1d20")}>d20</button>
            <button type="button" onClick={() => rollFromToken(contextToken, "Initiative", d20(contextCharacter?.abilities?.dexterity))}>Initiative</button>
            <button type="button" onClick={() => rollFromToken(contextToken, "Perception check", d20(contextCharacter?.skills?.Perception))}>Perception</button>
            {ABILITIES.map((ability) => <button type="button" title={`${ability} check`} onClick={() => rollFromToken(contextToken, `${ability} check`, d20(contextCharacter?.abilities?.[ability]))} key={ability}>{ability.slice(0, 3).toUpperCase()}</button>)}
            <button type="button" onClick={() => { const expression = window.prompt("Public roll expression", "1d20"); if (expression) rollFromToken(contextToken, window.prompt("Roll label", "Custom roll") || "Custom roll", expression); }}>Custom…</button>
          </div></section>}
        </div>}
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
      </> : selectedAnnotation ? <>{["x", "y", ...(selectedAnnotation.kind === "circle" ? ["radius"] : selectedAnnotation.kind === "cone" ? ["radius", "angle", "rotation"] : selectedAnnotation.kind === "line" ? ["x2", "y2"] : selectedAnnotation.kind === "rectangle" ? ["width", "height", "rotation"] : [])].map((key) => <label key={key}>{key}<input type="number" disabled={!canEditAnnotation(selectedAnnotation)} value={Math.round(selectedAnnotation.geometry[key] || 0)} onChange={(event) => setState((old) => ({ ...old, annotations: old.annotations.map((item) => item.id === selectedAnnotation.id ? { ...item, geometry: { ...item.geometry, [key]: Number(event.target.value) } } : item) }))} onBlur={() => updateAnnotation({ geometry: selectedAnnotation.geometry })} /></label>)}<label>Label<input disabled={!canEditAnnotation(selectedAnnotation)} value={selectedAnnotation.label} onChange={(event) => setState((old) => ({ ...old, annotations: old.annotations.map((item) => item.id === selectedAnnotation.id ? { ...item, label: event.target.value } : item) }))} onBlur={() => updateAnnotation({ label: selectedAnnotation.label })} /></label>{isWarden && <><label><input type="checkbox" checked={selectedAnnotation.locked} onChange={(event) => updateAnnotation({ locked: event.target.checked })} /> Locked</label><label><input type="checkbox" checked={selectedAnnotation.hidden} onChange={(event) => updateAnnotation({ hidden: event.target.checked })} /> Hidden</label></>}</> : isWarden ? <><label>Scene name<input value={state.scene.name} onChange={(event) => setState((old) => ({ ...old, scene: { ...old.scene, name: event.target.value } }))} onBlur={() => updateScene({ name: state.scene.name })} /></label>{[["Grid size","grid_size"],["Grid offset X","grid_offset_x"],["Grid offset Y","grid_offset_y"],["Units/square","units_per_square"]].map(([label, key]) => <label key={key}>{label}<input type="number" min={key === "grid_size" ? 5 : undefined} value={state.scene[key]} onChange={(event) => setState((old) => ({ ...old, scene: { ...old.scene, [key]: Number(event.target.value) } }))} onBlur={() => updateScene({ [key]: state.scene[key] })} /></label>)}<label>Unit label<input value={state.scene.unit_label} onChange={(event) => setState((old) => ({ ...old, scene: { ...old.scene, unit_label: event.target.value } }))} onBlur={() => updateScene({ unit_label: state.scene.unit_label })} /></label><label><input type="checkbox" checked={state.scene.grid_visible} onChange={(event) => updateScene({ grid_visible: event.target.checked })} /> Show grid</label><label><input type="checkbox" checked={state.scene.snap_enabled} onChange={(event) => updateScene({ snap_enabled: event.target.checked })} /> Snap to grid</label></> : <p>Select your token or choose a map tool.</p>}</div>, { sceneId })}
    </div>}
  </section>;
}
