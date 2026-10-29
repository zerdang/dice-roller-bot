import { useCallback, useEffect, useRef, useState } from "react";
import { conePath, euclideanDistance, screenToWorld, snapPoint, zoomAt } from "./battlemapGeometry.js";

const TOOLS = ["select", "pan", "token", "marker", "circle", "cone", "line", "rectangle", "ruler", "ping"];

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

export default function Battlemap({ dashboard, request, reportError }) {
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
  const svgRef = useRef(null);
  const isWarden = dashboard.role === "warden";
  const playerId = dashboard.characters?.[0]?.id;

  const loadScenes = useCallback(async () => {
    const list = await request("/api/battlemap/scenes");
    setScenes(list);
    setSceneId((current) => current && list.some((item) => item.id === current) ? current : list.find((item) => item.is_active)?.id || list[0]?.id || null);
  }, [request]);

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
    if (tool === "pan" || event.button === 1) {
      event.currentTarget.setPointerCapture(event.pointerId);
      setInteraction({ type: "pan", start: point(event), view }); return;
    }
    const at = worldPoint(event);
    if (["token", "marker", "circle", "cone", "line", "rectangle"].includes(tool)) {
      mutate(() => createAt(tool, at)); setTool("select"); return;
    }
    if (tool === "ruler") { setInteraction({ type: "ruler", start: at, end: at }); return; }
    if (tool === "ping") {
      setPing(at); window.setTimeout(() => setPing(null), 3000);
      mutate(() => request("/api/battlemap/pings", { method: "POST", body: JSON.stringify({ scene_id: state.scene.id, x: at.x, y: at.y }) })); return;
    }
    setSelectedId(null);
    setSelectedAnnotationId(null);
  };

  const tokenDown = (event, token) => {
    event.stopPropagation(); setSelectedId(token.id); setSelectedAnnotationId(null);
    if (tool !== "select" || !canMove(token)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setInteraction({ type: "token", token, start: worldPoint(event), original: { x: token.x, y: token.y } });
  };

  const annotationDown = (event, item) => {
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

  const selected = state.tokens.find((item) => item.id === selectedId);
  const selectedAnnotation = state.annotations.find((item) => item.id === selectedAnnotationId);
  const grid = state.scene && state.scene.grid_visible ? {
    backgroundSize: `${state.scene.grid_size * view.zoom}px ${state.scene.grid_size * view.zoom}px`,
    backgroundPosition: `${view.x + state.scene.grid_offset_x * view.zoom}px ${view.y + state.scene.grid_offset_y * view.zoom}px`,
  } : {};
  const rulerDistance = interaction?.type === "ruler" ? euclideanDistance(interaction.start, interaction.end, state.scene) : null;

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") { setInteraction(null); setTool("select"); }
      if (!selected || event.target.matches("input,textarea,select") || !canMove(selected)) return;
      const movement = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!movement) return;
      event.preventDefault();
      const step = event.shiftKey ? 1 : (state.scene.grid_size || 1);
      mutate(() => request(`/api/battlemap/tokens/${selected.id}`, { method: "PATCH", body: JSON.stringify(operation({ revision: selected.revision, x: selected.x + movement[0] * step, y: selected.y + movement[1] * step })) }));
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [selected, state.scene]);

  return <section className="battlemap-workspace">
    <header className="battlemap-header">
      <div><p className="index">D&D // SHARED TABLE</p><h2>Battlemap</h2></div>
      <span className={`connection ${connected ? "online" : "offline"}`}>{pending ? "SAVING" : connected ? "SYNCHRONIZED" : "RECONNECTING"}</span>
      {isWarden && <><select aria-label="Scene" value={sceneId || ""} onChange={(event) => setSceneId(Number(event.target.value))}>{scenes.map((scene) => <option value={scene.id} key={scene.id}>{scene.is_active ? "★ " : ""}{scene.name}</option>)}</select><button type="button" onClick={createScene}>New</button>{state.scene && <button type="button" onClick={duplicateScene}>Duplicate</button>}<label className="map-upload">Upload map<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => uploadMap(event.target.files?.[0])} /></label>{state.scene && !state.scene.is_active && <button type="button" onClick={() => updateScene({ activate: true })}>Activate</button>}{state.scene && <button type="button" className="delete-record" onClick={deleteScene}>Delete scene</button>}</>}
    </header>
    {!state.scene ? <div className="battlemap-empty">{isWarden ? <><p>No scene exists yet.</p><button type="button" onClick={createScene}>Create first scene</button></> : <p>The DM has not activated a scene.</p>}</div> : <div className="battlemap-layout">
      <nav className="map-tools" aria-label="Battlemap tools">{TOOLS.map((name) => <button type="button" className={tool === name ? "active" : ""} aria-pressed={tool === name} disabled={name === "token" && !isWarden} onClick={() => setTool(name)} key={name}>{name}</button>)}<button type="button" onClick={fit}>Fit</button><button type="button" onClick={() => setView({ x: 20, y: 20, zoom: 1 })}>Reset</button></nav>
      <div className="map-stage" style={grid} onWheel={(event) => { event.preventDefault(); setView((old) => zoomAt(old, point(event), old.zoom * (event.deltaY < 0 ? 1.12 : .89))); }}>
        <svg ref={svgRef} aria-label={`${state.scene.name} battlemap`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => setInteraction(null)}>
          <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
            {mapUrl ? <image href={mapUrl} width={state.scene.width} height={state.scene.height} preserveAspectRatio="none" /> : <rect className="map-background" width={state.scene.width} height={state.scene.height} />}
            <g className="map-annotations">{state.annotations.map((item) => <g className={`map-annotation${selectedAnnotationId === item.id ? " selected" : ""}`} role="button" tabIndex="0" key={item.id} aria-label={`${item.kind}: ${item.label}`} onFocus={() => { setSelectedAnnotationId(item.id); setSelectedId(null); }} onPointerDown={(event) => annotationDown(event, item)}>{annotationShape(item)}</g>)}</g>
            {interaction?.type === "ruler" && <g className="map-ruler"><line x1={interaction.start.x} y1={interaction.start.y} x2={interaction.end.x} y2={interaction.end.y} /><text x={interaction.end.x} y={interaction.end.y - 10}>{rulerDistance.toFixed(1)} {state.scene.unit_label}</text></g>}
            {[...sharedPings, ...(ping ? [{ id: "local", ...ping }] : [])].map((item) => <circle className="map-ping" cx={item.x} cy={item.y} r={state.scene.grid_size * .5} key={item.id} />)}
            <g className="map-tokens">{state.tokens.map((token) => { const size = state.scene.grid_size * token.size; return <g className={`map-token${selectedId === token.id ? " selected" : ""}${token.locked ? " locked" : ""}`} role="button" tabIndex="0" aria-label={`${token.name}${token.locked ? ", locked" : ""}`} transform={`translate(${token.x} ${token.y})`} onFocus={() => { setSelectedId(token.id); setSelectedAnnotationId(null); }} onPointerDown={(event) => tokenDown(event, token)} key={token.id}><TokenVisual token={token} size={size} request={request} /><circle className="token-outline" r={size / 2} fill="none" /><text y={size / 2 + 16} textAnchor="middle">{token.name}</text>{token.tags?.map((tag, index) => <text className="token-tag" x={size / 2} y={-size / 2 + index * 13} key={tag.key || tag.label}>{tag.icon || tag.label}</text>)}</g>; })}</g>
          </g>
        </svg>
      </div>
      <aside className="map-inspector"><div className="inspector-actions"><button type="button" onClick={() => mutate(() => request("/api/battlemap/undo", { method: "POST" }))}>Undo</button>{selected && isWarden && <button type="button" className="delete-record" onClick={() => window.confirm(`Remove ${selected.name}?`) && mutate(async () => { await request(`/api/battlemap/tokens/${selected.id}`, { method: "DELETE", headers: { "X-Operation-ID": crypto.randomUUID() } }); setSelectedId(null); })}>Delete</button>}{selectedAnnotation && canEditAnnotation(selectedAnnotation) && <button type="button" className="delete-record" onClick={() => window.confirm(`Remove ${selectedAnnotation.label}?`) && mutate(async () => { await request(`/api/battlemap/annotations/${selectedAnnotation.id}`, { method: "DELETE", headers: { "X-Operation-ID": crypto.randomUUID() } }); setSelectedAnnotationId(null); })}>Delete</button>}</div><h3>{selected ? selected.name : selectedAnnotation ? selectedAnnotation.label : "Scene controls"}</h3>{selected ? <>
        <label>X<input type="number" value={Math.round(selected.x)} onChange={(event) => setState((old) => ({ ...old, tokens: old.tokens.map((item) => item.id === selected.id ? { ...item, x: Number(event.target.value) } : item) }))} onBlur={() => updateSelected({ x: selected.x })} /></label>
        <label>Y<input type="number" value={Math.round(selected.y)} onChange={(event) => setState((old) => ({ ...old, tokens: old.tokens.map((item) => item.id === selected.id ? { ...item, y: Number(event.target.value) } : item) }))} onBlur={() => updateSelected({ y: selected.y })} /></label>
        {isWarden && <><label>Name<input value={selected.name} onChange={(event) => setState((old) => ({ ...old, tokens: old.tokens.map((item) => item.id === selected.id ? { ...item, name: event.target.value } : item) }))} onBlur={() => updateSelected({ name: selected.name })} /></label><label className="map-upload">Upload portrait<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => uploadPortrait(event.target.files?.[0])} /></label><label>Turn-order link<select value={selected.turn_entry_id || ""} onChange={(event) => updateSelected({ turn_entry_id: event.target.value ? Number(event.target.value) : null })}><option value="">None</option>{dashboard.turn_order.map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}</select></label><label><input type="checkbox" checked={selected.locked} onChange={(event) => updateSelected({ locked: event.target.checked })} /> Locked</label><label><input type="checkbox" checked={selected.hidden} onChange={(event) => updateSelected({ hidden: event.target.checked })} /> Hidden from players</label><fieldset><legend>Owners</legend>{dashboard.characters.map((character) => <label key={character.id}><input type="checkbox" checked={selected.owners.includes(character.id)} onChange={(event) => updateSelected({ owners: event.target.checked ? [...selected.owners, character.id] : selected.owners.filter((id) => id !== character.id) })} /> {character.name}</label>)}</fieldset></>}
        <div className="counter-list">{selected.counters?.map((counter) => <div key={counter.key}><span>{counter.label}</span><button type="button" onClick={() => mutate(() => request(`/api/battlemap/tokens/${selected.id}/counters/${counter.key}/delta`, { method: "POST", body: JSON.stringify({ revision: selected.revision, delta: -1, operation_id: crypto.randomUUID() }) }))}>−</button><b>{counter.value}</b><button type="button" onClick={() => mutate(() => request(`/api/battlemap/tokens/${selected.id}/counters/${counter.key}/delta`, { method: "POST", body: JSON.stringify({ revision: selected.revision, delta: 1, operation_id: crypto.randomUUID() }) }))}>+</button></div>)}</div>
        <button type="button" onClick={() => { const label = window.prompt("Counter label"); if (label) updateSelected({ counters: [...(selected.counters || []), { key: crypto.randomUUID(), label, value: 0 }] }); }}>Add counter</button><button type="button" onClick={() => { const label = window.prompt("Tag label"); if (label) updateSelected({ tags: [...(selected.tags || []), { key: crypto.randomUUID(), label }] }); }}>Add tag</button><section className="preset-list"><h4>Presets</h4>{state.presets.map((preset) => <div key={preset.id}><button type="button" onClick={() => applyPreset(preset)}>Apply {preset.name}</button>{isWarden && <><button type="button" aria-label={`Edit ${preset.name} preset`} onClick={() => editPreset(preset)}>Edit</button><button type="button" aria-label={`Delete ${preset.name} preset`} onClick={() => deletePreset(preset)}>×</button></>}</div>)}{isWarden && <button type="button" onClick={createPreset}>New preset</button>}</section>
      </> : selectedAnnotation ? <>{["x", "y", ...(selectedAnnotation.kind === "circle" ? ["radius"] : selectedAnnotation.kind === "cone" ? ["radius", "angle", "rotation"] : selectedAnnotation.kind === "line" ? ["x2", "y2"] : selectedAnnotation.kind === "rectangle" ? ["width", "height", "rotation"] : [])].map((key) => <label key={key}>{key}<input type="number" disabled={!canEditAnnotation(selectedAnnotation)} value={Math.round(selectedAnnotation.geometry[key] || 0)} onChange={(event) => setState((old) => ({ ...old, annotations: old.annotations.map((item) => item.id === selectedAnnotation.id ? { ...item, geometry: { ...item.geometry, [key]: Number(event.target.value) } } : item) }))} onBlur={() => updateAnnotation({ geometry: selectedAnnotation.geometry })} /></label>)}<label>Label<input disabled={!canEditAnnotation(selectedAnnotation)} value={selectedAnnotation.label} onChange={(event) => setState((old) => ({ ...old, annotations: old.annotations.map((item) => item.id === selectedAnnotation.id ? { ...item, label: event.target.value } : item) }))} onBlur={() => updateAnnotation({ label: selectedAnnotation.label })} /></label>{isWarden && <><label><input type="checkbox" checked={selectedAnnotation.locked} onChange={(event) => updateAnnotation({ locked: event.target.checked })} /> Locked</label><label><input type="checkbox" checked={selectedAnnotation.hidden} onChange={(event) => updateAnnotation({ hidden: event.target.checked })} /> Hidden</label></>}</> : isWarden ? <><label>Scene name<input value={state.scene.name} onChange={(event) => setState((old) => ({ ...old, scene: { ...old.scene, name: event.target.value } }))} onBlur={() => updateScene({ name: state.scene.name })} /></label>{[["Grid size","grid_size"],["Grid offset X","grid_offset_x"],["Grid offset Y","grid_offset_y"],["Units/square","units_per_square"]].map(([label, key]) => <label key={key}>{label}<input type="number" min={key === "grid_size" ? 5 : undefined} value={state.scene[key]} onChange={(event) => setState((old) => ({ ...old, scene: { ...old.scene, [key]: Number(event.target.value) } }))} onBlur={() => updateScene({ [key]: state.scene[key] })} /></label>)}<label>Unit label<input value={state.scene.unit_label} onChange={(event) => setState((old) => ({ ...old, scene: { ...old.scene, unit_label: event.target.value } }))} onBlur={() => updateScene({ unit_label: state.scene.unit_label })} /></label><label><input type="checkbox" checked={state.scene.grid_visible} onChange={(event) => updateScene({ grid_visible: event.target.checked })} /> Show grid</label><label><input type="checkbox" checked={state.scene.snap_enabled} onChange={(event) => updateScene({ snap_enabled: event.target.checked })} /> Snap to grid</label></> : <p>Select your token or choose a map tool.</p>}</aside>
    </div>}
  </section>;
}
