import { useCallback, useEffect, useRef, useState } from "react";
import ReferenceBrowser from "./ReferenceBrowser";
import CharacterBuilder from "./CharacterBuilder";

const operationId = () => crypto.randomUUID();
const clampSidebarWidth = value => Math.max(340, Math.min(window.innerWidth - 260, value));
const dice = [4, 6, 8, 10, 12, 20, 100];

function GameLog({ cards, rolls, role, audience, setAudience, request, refresh, reportError }) {
  const [actorId, setActorId] = useState(cards[0]?.id || "");
  const [label, setLabel] = useState("Custom roll");
  const [expression, setExpression] = useState("1d20");
  const [error, setError] = useState("");
  useEffect(() => { if (!cards.some((card) => card.id === Number(actorId))) setActorId(cards[0]?.id || ""); }, [cards, actorId]);
  const submit = async (event) => {
    event.preventDefault(); setError("");
    if (!actorId) { setError("Choose an authorized actor."); return; }
    try {
      const clean = expression.trim().replace(/^\/r\s+/i, "");
      await request(`/api/dnd/characters/${actorId}/rolls`, { method: "POST", body: JSON.stringify({ kind: "custom", label, expression: clean, mode: "normal", audience, operation_id: operationId() }) });
      setExpression("");
      await refresh(true);
    } catch (caught) { setError(caught.message || "Roll failed"); reportError(caught); }
  };
  return <section className="sidebar-pane log-pane">
    <header><div><h2>Game Log</h2><p>Campaign roll chat</p></div></header>
    <div className="log-scroll" aria-live="polite">{[...rolls].reverse().map((roll) => <div className={`chat-roll-row${roll.is_own ? " own" : ""}`} key={roll.id}>
      {!roll.is_own && <span className="actor-fallback" aria-hidden="true">{roll.actor_name.slice(0, 1)}</span>}
      <details className={`log-card${roll.audience !== "public" ? " private" : ""}`}>
        <summary><span><b>{roll.is_own ? "You" : roll.actor_name}</b><small>{roll.label}</small></span><strong>{roll.total}</strong></summary>
        <div><span>{roll.expression}</span><span>Dice: {roll.dice.join(", ") || "—"}</span><span>Selected: {roll.selected.join(", ") || "—"}</span><span>{roll.mode}</span></div>
        <footer><em className={`audience-label ${roll.audience}`}>{roll.audience === "public" ? "Public" : roll.audience === "dm" ? "DM only" : "Private"}</em><time dateTime={roll.created_at}>{new Date(roll.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></footer>
      </details>
    </div>)}{!rolls.length && <p className="empty-state">Rolls will appear here like a conversation.</p>}</div>
    <form className="log-composer chat-composer" onSubmit={submit}>
      {role === "warden" && <label>Roll as<select aria-label="Roll actor" value={actorId} onChange={(event) => setActorId(event.target.value)}>{cards.map((card) => <option value={card.id} key={card.id}>{card.name}</option>)}</select></label>}
      <label>Label<input value={label} onChange={(event) => setLabel(event.target.value)} /></label>
      <div className="chat-input-row"><input aria-label="Dice expression" value={expression} onChange={(event) => setExpression(event.target.value)} placeholder="Type a roll, e.g. 1d20+4" /><button type="submit">Roll</button></div>
      <label className="audience-control">Send as<select value={audience} onChange={(event) => setAudience(event.target.value)}><option value="public">Public — everyone</option><option value="private">Private — player + DM</option>{role === "warden" && <option value="dm">DM only</option>}</select></label>
      {error && <p className="field-error">{error}</p>}
      <div className="dice-shortcuts">{dice.map((sides) => <button type="button" onClick={() => setExpression(`1d${sides}`)} key={sides}>d{sides}</button>)}</div>
    </form>
  </section>;
}

function PartyBrowser({ roster, role, activeName, onOpenSheet }) {
  const [query, setQuery] = useState("");
  return <section className="sidebar-pane party-pane">
    <header><div><h2>Party</h2><p>{role === "warden" ? "Inspect, locate, and place characters" : "Shared encounter summary"}</p></div></header>
    <input className="sidebar-search" type="search" placeholder="Search party" value={query} onChange={(event) => setQuery(event.target.value)} />
    <div className="sidebar-scroll">{roster.filter((card) => card.name.toLowerCase().includes(query.toLowerCase())).map((card) => <article className={`party-card${card.name === activeName ? " active-turn" : ""}`} key={card.id}>
      {card.name === activeName && <span className="turn-chip">Current turn</span>}
      <button type="button" className="party-identity" disabled={!card.can_open} onClick={() => card.can_open && onOpenSheet(card.id)}><span className="actor-fallback">{card.name.slice(0, 1)}</span><span><b>{card.name}</b><small>{[card.identity?.class_name, card.identity?.level ? `Level ${card.identity.level}` : ""].filter(Boolean).join(" · ") || (card.can_open ? "Inspect character" : "Shared party summary")}</small></span></button>
      <div className="party-stats"><span><b>{card.speed}</b>Speed</span><span><b>{card.armor_class}</b>Armor Class</span><span><b>{card.passives?.Perception ?? "—"}</b>Passive</span><span><b>{card.hp}/{card.max_hp}</b>Hit Points</span></div>
      {card.conditions?.length > 0 && <p className="condition-summary"><b>Conditions:</b> {card.conditions.map((item) => item.name).join(", ")}</p>}
      <div className="party-actions"><button type="button" onClick={() => window.dispatchEvent(new CustomEvent("dnd-center-character", { detail: card.id }))}>Locate</button>{role === "warden" && card.can_open && <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("dnd-place-character", { detail: { id: card.id, name: card.name } }))}>Place</button>}{card.can_open && <button type="button" onClick={() => onOpenSheet(card.id)}>{role === "warden" ? "Inspect" : "Open sheet"}</button>}</div>
    </article>)}</div>
  </section>;
}

function MyCharacter({ card, request, refresh, reportError, onOpenSheet, onOpenLog }) {
  const [busy, setBusy] = useState(false);
  if (!card) return <section className="sidebar-pane"><header><div><h2>My Character</h2><p>No character is assigned to this link</p></div></header></section>;
  const delta = async (amount) => {
    if (busy) return;
    try { setBusy(true); await request(`/api/dnd/characters/${card.id}/resources`, { method: "POST", body: JSON.stringify({ field: "hp", delta: amount, operation_id: operationId() }) }); await refresh(true); }
    catch (error) { reportError(error); } finally { setBusy(false); }
  };
  return <section className="sidebar-pane character-pane"><header><div><h2>My Character</h2><p>Encounter essentials</p></div></header><div className="character-hud"><div className="hud-identity"><span className="actor-fallback">{card.name.slice(0, 1)}</span><div><b>{card.name}</b><span>{[card.identity?.class_name, card.identity?.level ? `Level ${card.identity.level}` : ""].filter(Boolean).join(" · ") || "D&D character"}</span></div></div><div className="hud-vitals"><article><span>Hit Points</span><strong>{card.hp} / {card.max_hp}</strong>{card.temp_hp > 0 && <small>+{card.temp_hp} temporary</small>}<div><button disabled={busy} onClick={() => delta(-1)} aria-label="Decrease hit points">−</button><button disabled={busy} onClick={() => delta(1)} aria-label="Increase hit points">+</button></div></article><article><span>Armor Class</span><strong>{card.armor_class}</strong></article><article><span>Speed</span><strong>{card.speed}</strong></article></div><div className="hud-status"><span className={card.concentrating ? "active" : ""}>Concentration: {card.concentrating ? "Active" : "No"}</span><span className={card.heroic_inspiration ? "active" : ""}>Inspiration: {card.heroic_inspiration ? "Ready" : "None"}</span><span>Exhaustion: {card.exhaustion || 0}</span></div><div className="hud-conditions"><b>Conditions</b><p>{card.conditions?.length ? card.conditions.map((item) => item.name).join(", ") : "None"}</p></div><div className="hud-actions"><button type="button" className="primary-action" onClick={() => onOpenSheet(card.id)}>Open sheet</button><button type="button" onClick={onOpenLog}>Roll dice</button><button type="button" onClick={() => window.dispatchEvent(new CustomEvent("dnd-center-character", { detail: card.id }))}>Locate token</button></div></div></section>;
}

function SceneBrowser({ request, reportError, viewedSceneId }) {
  const [scenes, setScenes] = useState([]);
  const [folders, setFolders] = useState([]);
  const [query, setQuery] = useState("");
  const [dropTarget, setDropTarget] = useState(null);
  const [sceneEditor, setSceneEditor] = useState(null);
  const [scenePreview, setScenePreview] = useState("");
  const [folderEditor, setFolderEditor] = useState(null);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    try {
      setScenes(await request("/api/battlemap/scenes"));
      setFolders(await request("/api/battlemap/scene-folders"));
    } catch (error) { reportError(error); }
  }, [request, reportError]);
  const notifySceneChange = () => window.dispatchEvent(new Event("dnd-scenes-changed"));
  useEffect(() => { load(); const reload = () => load(); window.addEventListener("dnd-scenes-changed", reload); return () => window.removeEventListener("dnd-scenes-changed", reload); }, [load]);
  useEffect(() => { if (!sceneEditor?.file) { setScenePreview(""); return undefined; } const url = URL.createObjectURL(sceneEditor.file); setScenePreview(url); return () => URL.revokeObjectURL(url); }, [sceneEditor?.file]);
  const view = (scene) => window.dispatchEvent(new CustomEvent("dnd-preview-scene", { detail: scene.id }));
  const activate = async (scene) => {
    if (scene.is_active) return;
    try {
      await request(`/api/battlemap/scenes/${scene.id}`, { method: "PATCH", body: JSON.stringify({ revision: scene.revision, activate: true, operation_id: operationId() }) });
      await load();
      notifySceneChange();
    } catch (error) { reportError(error); }
  };
  const saveFolder = async (event) => {
    event.preventDefault();
    const name = folderEditor?.name.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      const folder = folderEditor.folder;
      const created = folder
        ? await request(`/api/battlemap/scene-folders/${folder.id}`, { method: "PATCH", body: JSON.stringify({ name }) })
        : await request("/api/battlemap/scene-folders", { method: "POST", body: JSON.stringify({ name }) });
      setFolderEditor(null);
      if (!folder && sceneEditor) setSceneEditor(current => current && { ...current, folderId: String(created.id) });
      await load(); notifySceneChange();
    } catch (error) { reportError(error); }
    finally { setSaving(false); }
  };
  const saveScene = async (event) => {
    event.preventDefault();
    const draft = sceneEditor;
    const name = draft?.name.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      let asset = null;
      if (draft.file) {
        const data = new FormData(); data.append("file", draft.file);
        asset = await request("/api/battlemap/assets", { method: "POST", body: data, headers: { "X-Operation-ID": operationId() } });
      }
      let scene = draft.scene;
      if (!scene) scene = await request("/api/battlemap/scenes", { method: "POST", body: JSON.stringify({ name, operation_id: operationId(), ...(asset ? { width: asset.width, height: asset.height } : {}) }) });
      const changes = { ...(scene.name !== name ? { name } : {}), ...(String(scene.folder_id || "") !== draft.folderId ? { folder_id: draft.folderId ? Number(draft.folderId) : null } : {}), ...(asset ? { asset_id: asset.id, width: asset.width, height: asset.height } : {}) };
      if (Object.keys(changes).length) scene = await request(`/api/battlemap/scenes/${scene.id}`, { method: "PATCH", body: JSON.stringify({ revision: scene.revision, ...changes, operation_id: operationId() }) });
      setSceneEditor(null);
      await load(); notifySceneChange(); view(scene);
    } catch (error) { reportError(error); }
    finally { setSaving(false); }
  };
  const hideScene = async (scene) => {
    try { await request(`/api/battlemap/scenes/${scene.id}`, { method: "PATCH", body: JSON.stringify({ revision: scene.revision, deactivate: true, operation_id: operationId() }) }); await load(); notifySceneChange(); }
    catch (error) { reportError(error); }
  };
  const duplicateScene = async (scene) => {
    try { const copy = await request(`/api/battlemap/scenes/${scene.id}/duplicate`, { method: "POST", headers: { "X-Operation-ID": operationId() } }); setSceneEditor(null); await load(); notifySceneChange(); view(copy); }
    catch (error) { reportError(error); }
  };
  const deleteScene = async (scene) => {
    if (!window.confirm(`Permanently delete ${scene.name}?`)) return;
    try { await request(`/api/battlemap/scenes/${scene.id}`, { method: "DELETE", headers: { "X-Operation-ID": operationId() } }); setSceneEditor(null); await load(); notifySceneChange(); }
    catch (error) { reportError(error); }
  };
  const toggleFavorite = async (scene) => {
    try { await request(`/api/battlemap/scenes/${scene.id}/favorite`, { method: "PUT", body: JSON.stringify({ favorite: !scene.favorite }) }); await load(); }
    catch (error) { reportError(error); }
  };
  const deleteFolder = async (folder) => {
    if (!window.confirm(`Delete ${folder.name}? Its scenes will move to Unfiled.`)) return;
    try { await request(`/api/battlemap/scene-folders/${folder.id}`, { method: "DELETE" }); await load(); notifySceneChange(); }
    catch (error) { reportError(error); }
  };
  const moveScene = async (sceneId, folderId) => {
    const scene = scenes.find((item) => item.id === Number(sceneId));
    if (!scene || (scene.folder_id || null) === folderId) return;
    try {
      await request(`/api/battlemap/scenes/${scene.id}`, { method: "PATCH", body: JSON.stringify({ revision: scene.revision, folder_id: folderId, operation_id: operationId() }) });
      await load();
      notifySceneChange();
    } catch (error) { reportError(error); }
  };
  const drop = (event, folderId) => {
    event.preventDefault(); setDropTarget(null);
    const sceneId = Number(event.dataTransfer.getData("application/x-battlemap-scene"));
    if (sceneId) moveScene(sceneId, folderId);
  };
  const rows = (folderId) => scenes.filter((scene) => (scene.folder_id || null) === folderId && scene.name.toLowerCase().includes(query.toLowerCase()));
  const row = (scene) => <article className={`scene-sidebar-row${scene.is_active ? " live" : ""}${scene.id === viewedSceneId ? " viewed" : ""}`} draggable="true" onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-battlemap-scene", String(scene.id)); }} key={scene.id}>
    <button type="button" className="scene-name" onClick={() => view(scene)}><b>{scene.name}</b><small>{scene.is_active && scene.id === viewedSceneId ? "You and players" : scene.is_active ? "Players are here" : scene.id === viewedSceneId ? "Private DM view" : "Drag to organize"}</small></button>
    <button type="button" className={scene.id === viewedSceneId ? "active" : ""} disabled={scene.id === viewedSceneId} onClick={() => view(scene)}>{scene.id === viewedSceneId ? "Viewing" : "View"}</button>
    <button type="button" className={scene.is_active ? "active" : "show-scene"} onClick={() => scene.is_active ? hideScene(scene) : activate(scene)}>{scene.is_active ? "Hide" : "Show"}</button>
    <button type="button" onClick={() => setSceneEditor({ scene, name: scene.name, folderId: String(scene.folder_id || ""), file: null })}>Edit</button>
    <button type="button" aria-label={`${scene.favorite ? "Remove" : "Add"} ${scene.name} ${scene.favorite ? "from" : "to"} favorites`} title={scene.favorite ? "Remove favorite" : "Favorite"} onClick={() => toggleFavorite(scene)}>{scene.favorite ? "★" : "☆"}</button>
  </article>;
  const group = (folder) => {
    const folderId = folder?.id ?? null;
    const items = rows(folderId);
    const targetKey = folderId ?? "unfiled";
    return <section className={`scene-folder-group${dropTarget === targetKey ? " drop-target" : ""}`} onDragEnter={() => setDropTarget(targetKey)} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDropTarget(null); }} onDrop={(event) => drop(event, folderId)} key={targetKey}>
      <header><div><strong>{folder?.name || "Unfiled"}</strong><span>{items.length}</span></div>{folder && <div><button type="button" aria-label={`Rename ${folder.name}`} onClick={() => setFolderEditor({ folder, name: folder.name })}>Rename</button><button type="button" className="delete-record" aria-label={`Delete ${folder.name}`} onClick={() => deleteFolder(folder)}>Delete</button></div>}</header>
      {items.map(row)}{!items.length && <p>Drop scenes here</p>}
    </section>;
  };
  const viewed = scenes.find((scene) => scene.id === viewedSceneId);
  const live = scenes.find((scene) => scene.is_active);
  return <section className="sidebar-pane scene-pane"><header><div><h2>Scenes</h2><p>Your view and player view</p></div></header><div className="scene-sidebar-tools"><button type="button" onClick={() => setSceneEditor({ scene: null, name: `Scene ${scenes.length + 1}`, folderId: "", file: null })}>New scene</button><button type="button" onClick={() => setFolderEditor({ folder: null, name: "" })}>New folder</button></div><div className="sidebar-scroll scene-folder-scroll"><div className="scene-view-status"><span><b>You</b>{viewed?.name || "No scene"}</span><span><b>Players</b>{live?.name || "No live scene"}</span>{viewed && !viewed.is_active && <button type="button" className="show-scene" onClick={() => activate(viewed)}>Show my view</button>}{live && live.id !== viewedSceneId && <button type="button" onClick={() => view(live)}>View live</button>}</div>{folderEditor && <form className="sidebar-scene-editor" onSubmit={saveFolder}><label>{folderEditor.folder ? "Rename folder" : "Folder name"}<input autoFocus maxLength={80} required value={folderEditor.name} onChange={event => setFolderEditor(current => ({ ...current, name: event.target.value }))} /></label><div><button type="submit" disabled={saving || !folderEditor.name.trim()}>Save folder</button><button type="button" onClick={() => setFolderEditor(null)}>Cancel</button></div></form>}{sceneEditor && <form className="sidebar-scene-editor" onSubmit={saveScene}><h3>{sceneEditor.scene ? "Edit scene" : "New scene"}</h3><label>Scene name<input autoFocus maxLength={100} required value={sceneEditor.name} onChange={event => setSceneEditor(current => ({ ...current, name: event.target.value }))} /></label><label>Folder<select value={sceneEditor.folderId} onChange={event => setSceneEditor(current => ({ ...current, folderId: event.target.value }))}><option value="">Unfiled</option>{folders.map(folder => <option value={folder.id} key={folder.id}>{folder.name}</option>)}</select></label><label>Map picture<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => setSceneEditor(current => ({ ...current, file: event.target.files?.[0] || null }))} /></label>{scenePreview && <img className="sidebar-scene-preview" src={scenePreview} alt="Selected map preview" />}{sceneEditor.file && <small>Selected: {sceneEditor.file.name}</small>}<div><button type="submit" disabled={saving || !sceneEditor.name.trim()}>{saving ? "Saving…" : "Save scene"}</button><button type="button" onClick={() => setSceneEditor(null)}>Cancel</button></div>{sceneEditor.scene && <div className="scene-editor-secondary"><button type="button" disabled={saving} onClick={() => duplicateScene(sceneEditor.scene)}>Duplicate</button><button type="button" className="delete-record" disabled={saving} onClick={() => deleteScene(sceneEditor.scene)}>Delete scene</button></div>}</form>}<input className="sidebar-search" type="search" placeholder="Search scenes" aria-label="Search scenes" value={query} onChange={(event) => setQuery(event.target.value)} />{folders.map(group)}{group(null)}</div></section>;
}

function QuickInspect({ card, activeName, onBack, onOpenSheet }) {
  if (!card) return null;
  return <section className="sidebar-pane quick-inspect-pane">
    <header><div><h2>{card.name}</h2><p>Quick encounter inspection</p></div><button type="button" onClick={onBack}>Back</button></header>
    <div className="quick-inspect-scroll">
      {card.name === activeName && <p className="active-turn-banner">Current turn</p>}
      <div className="hud-vitals"><article><span>Hit Points</span><strong>{card.hp} / {card.max_hp}</strong>{card.temp_hp > 0 && <small>+{card.temp_hp} temporary</small>}</article><article><span>Armor Class</span><strong>{card.armor_class}</strong></article><article><span>Speed</span><strong>{card.speed}</strong></article></div>
      <div className="quick-passives"><span><b>{card.passives?.Perception ?? "—"}</b> Passive Perception</span><span><b>{card.passives?.Investigation ?? "—"}</b> Passive Investigation</span><span><b>{card.passives?.Insight ?? "—"}</b> Passive Insight</span></div>
      <div className="hud-conditions"><b>Conditions</b><p>{card.conditions?.length ? card.conditions.map((item) => item.name).join(", ") : "None"}</p></div>
      <div className="hud-actions"><button type="button" className="primary-action" onClick={() => onOpenSheet(card.id)}>Open full sheet</button><button type="button" onClick={() => window.dispatchEvent(new CustomEvent("dnd-center-character", { detail: card.id }))}>Locate token</button><button type="button" onClick={() => window.dispatchEvent(new CustomEvent("dnd-place-character", { detail: { id: card.id, name: card.name } }))}>Place token</button></div>
    </div>
  </section>;
}

function SidebarIcon({ name }) {
  const shapes = {
    builder: <><path d="M4 4h11v16H4zM8 8h3M8 12h3M17 8v8M13 12h8" /></>,
    reference: <><path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1z" /><path d="M12 5v15" /></>,
    expand: <><path d="M9 6l6 6-6 6" /><path d="M4 4v16" /></>,
    collapse: <><path d="M15 6l-6 6 6 6" /><path d="M20 4v16" /></>,
    character: <><circle cx="12" cy="8" r="3.5" /><path d="M5.5 21c.7-4.5 2.8-6.5 6.5-6.5s5.8 2 6.5 6.5" /></>,
    party: <><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.5" /><path d="M3.5 20c.5-4.2 2.3-6 5.5-6s5 1.8 5.5 6M14 15c3.5-.8 5.5.8 6.2 4.2" /></>,
    log: <><path d="M4 5h16v12H9l-5 4z" /><path d="M8 9h8M8 13h6" /></>,
    scenes: <><path d="M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2z" /><path d="M9 4v14M15 6v14" /></>,
    selection: <path d="M6 3l12 11-6 .8 3.5 6-3 1.7-3.4-6-4 4z" />,
    reset: <path d="M4 8h12M4 8l4-4M4 8l4 4M20 16H8M20 16l-4-4M20 16l-4 4" />,
  };
  return <svg className="sidebar-nav-icon" viewBox="0 0 24 24" aria-hidden="true">{shapes[name]}</svg>;
}

export default function DndSidebar({ dashboard, cards, roster, rolls, audience, setAudience, request, refresh, reportError, onOpenSheet, selectionPanel, mapContext }) {
  const storageKey = `dnd-sidebar:${dashboard.campaign?.id || "campaign"}`;
  const saved = (() => { try { return JSON.parse(localStorage.getItem(storageKey) || "{}"); } catch { return {}; } })();
  const isWarden = dashboard.role === "warden";
  const tabs = isWarden ? ["log", "party", "scenes", "reference", "selection"] : ["character", "party", "log", "reference"];
  const fallbackTab = isWarden ? "party" : "character";
  const savedWidth = Number(saved.width);
  const [width, setWidth] = useState(Number.isFinite(savedWidth) ? clampSidebarWidth(savedWidth) : 400);
  const [tab, setTab] = useState(tabs.includes(saved.tab) ? saved.tab : fallbackTab);
  const [collapsed, setCollapsed] = useState(Boolean(saved.collapsed));
  const [quickCardId, setQuickCardId] = useState(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const dragRef = useRef(null);
  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify({ tab, collapsed, width })); }, [tab, collapsed, width, storageKey]);
  useEffect(() => { const move = (event) => { if (dragRef.current) setWidth(clampSidebarWidth(dragRef.current.width + dragRef.current.x - event.clientX)); }; const up = () => { dragRef.current = null; document.body.classList.remove("resizing-dnd-dock"); }; window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); }; }, []);
  useEffect(() => { const openScenes = () => { setTab("scenes"); setCollapsed(false); }; window.addEventListener("dnd-open-scenes", openScenes); return () => window.removeEventListener("dnd-open-scenes", openScenes); }, []);
  const choose = (next) => { setTab(next); setCollapsed(false); };
  const labels = { character: "My Character", party: "Party", log: "Game Log", scenes: "Scenes", reference: "Reference", selection: "Selection" };
  const activeName = dashboard.turn_order?.[0]?.name || "";
  const quickCard = roster.find((card) => card.id === quickCardId);
  return <aside className={`table-sidebar${collapsed ? " collapsed" : ""}`} style={{ width: collapsed ? 64 : width }}>
    {!collapsed && <button type="button" className="dock-resize-handle" aria-label="Resize sidebar" title="Drag or use arrow keys to resize sidebar" onPointerDown={(event) => { dragRef.current = { x: event.clientX, width: event.currentTarget.parentElement.getBoundingClientRect().width }; document.body.classList.add("resizing-dnd-dock"); }} onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setWidth(current => clampSidebarWidth(current + (event.key === "ArrowLeft" ? 40 : -40))); } }} />}
    <nav aria-label="Table sidebar">
      <button type="button" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setCollapsed(!collapsed)}><SidebarIcon name={collapsed ? "expand" : "collapse"} /></button>
      {tabs.map((name) => <button type="button" className={tab === name ? "active" : ""} aria-label={labels[name]} title={labels[name]} aria-current={tab === name ? "page" : undefined} onClick={() => { choose(name); if (name !== "party") setQuickCardId(null); }} key={name}><SidebarIcon name={name} /></button>)}
      <button type="button" aria-label="Character creation drafts" title="Character creation drafts" onClick={() => setBuilderOpen(true)}><SidebarIcon name="builder" /></button>
      {!collapsed && <button type="button" className="dock-reset" aria-label="Reset sidebar width" title="Reset sidebar width" onClick={() => setWidth(400)}><SidebarIcon name="reset" /></button>}
    </nav>
    {!collapsed && <div className="sidebar-content">
      {tab === "reference" && <ReferenceBrowser request={request} isWarden={isWarden} cards={cards} onGrant={() => refresh(true)} />}
      {tab === "character" && <MyCharacter card={cards[0]} request={request} refresh={refresh} reportError={reportError} onOpenSheet={onOpenSheet} onOpenLog={() => setTab("log")} />}
      {tab === "party" && (quickCard ? <QuickInspect card={quickCard} activeName={activeName} onBack={() => setQuickCardId(null)} onOpenSheet={onOpenSheet} /> : <PartyBrowser roster={roster} role={dashboard.role} activeName={activeName} onOpenSheet={isWarden ? setQuickCardId : onOpenSheet} />)}
      {tab === "log" && <GameLog cards={cards} rolls={rolls} role={dashboard.role} audience={audience} setAudience={setAudience} request={request} refresh={refresh} reportError={reportError} />}
      {tab === "scenes" && <SceneBrowser request={request} reportError={reportError} viewedSceneId={mapContext?.sceneId} />}
      {tab === "selection" && <section className="sidebar-pane selection-pane"><header><div><h2>Selection</h2><p>Contextual scene and token controls</p></div></header><div className="selection-scroll">{selectionPanel}</div></section>}
    </div>}
    {builderOpen && <CharacterBuilder request={request} isWarden={isWarden} onFinalized={() => refresh(true)} onClose={() => setBuilderOpen(false)} />}
  </aside>;
}
