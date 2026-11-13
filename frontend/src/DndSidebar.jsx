import { useCallback, useEffect, useRef, useState } from "react";

const operationId = () => crypto.randomUUID();
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
  const load = useCallback(async () => {
    try {
      setScenes(await request("/api/battlemap/scenes"));
      setFolders(await request("/api/battlemap/scene-folders"));
    } catch (error) { reportError(error); }
  }, [request, reportError]);
  const notifySceneChange = () => window.dispatchEvent(new Event("dnd-scenes-changed"));
  useEffect(() => { load(); }, [load]);
  const view = (scene) => window.dispatchEvent(new CustomEvent("dnd-preview-scene", { detail: scene.id }));
  const activate = async (scene) => {
    if (scene.is_active) return;
    try {
      await request(`/api/battlemap/scenes/${scene.id}`, { method: "PATCH", body: JSON.stringify({ revision: scene.revision, activate: true, operation_id: operationId() }) });
      await load();
      notifySceneChange();
    } catch (error) { reportError(error); }
  };
  const createFolder = async () => {
    const name = window.prompt("Folder name");
    if (!name?.trim()) return;
    try { await request("/api/battlemap/scene-folders", { method: "POST", body: JSON.stringify({ name }) }); await load(); notifySceneChange(); }
    catch (error) { reportError(error); }
  };
  const renameFolder = async (folder) => {
    const name = window.prompt("Rename folder", folder.name);
    if (!name?.trim() || name.trim() === folder.name) return;
    try { await request(`/api/battlemap/scene-folders/${folder.id}`, { method: "PATCH", body: JSON.stringify({ name }) }); await load(); notifySceneChange(); }
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
    <button type="button" className={scene.is_active ? "active" : "show-scene"} disabled={scene.is_active} onClick={() => activate(scene)}>{scene.is_active ? "Live" : "Show"}</button>
  </article>;
  const group = (folder) => {
    const folderId = folder?.id ?? null;
    const items = rows(folderId);
    const targetKey = folderId ?? "unfiled";
    return <section className={`scene-folder-group${dropTarget === targetKey ? " drop-target" : ""}`} onDragEnter={() => setDropTarget(targetKey)} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDropTarget(null); }} onDrop={(event) => drop(event, folderId)} key={targetKey}>
      <header><div><strong>{folder?.name || "Unfiled"}</strong><span>{items.length}</span></div>{folder && <div><button type="button" aria-label={`Rename ${folder.name}`} onClick={() => renameFolder(folder)}>Rename</button><button type="button" className="delete-record" aria-label={`Delete ${folder.name}`} onClick={() => deleteFolder(folder)}>Delete</button></div>}</header>
      {items.map(row)}{!items.length && <p>Drop scenes here</p>}
    </section>;
  };
  const viewed = scenes.find((scene) => scene.id === viewedSceneId);
  const live = scenes.find((scene) => scene.is_active);
  return <section className="sidebar-pane scene-pane"><header><div><h2>Scenes</h2><p>Organize, view privately, and publish</p></div><button type="button" onClick={createFolder}>New folder</button></header><input className="sidebar-search" type="search" placeholder="Search scenes" value={query} onChange={(event) => setQuery(event.target.value)} /><div className="scene-view-status"><span><b>You</b>{viewed?.name || "No scene"}</span><span><b>Players</b>{live?.name || "No live scene"}</span>{viewed && !viewed.is_active && <button type="button" className="show-scene" onClick={() => activate(viewed)}>Show my view</button>}{live && live.id !== viewedSceneId && <button type="button" onClick={() => view(live)}>View live</button>}</div><div className="sidebar-scroll scene-folder-scroll">{folders.map(group)}{group(null)}</div></section>;
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
  const tabs = isWarden ? ["log", "party", "scenes", "selection"] : ["character", "party", "log"];
  const fallbackTab = isWarden ? "party" : "character";
  const savedWidth = Number(saved.width);
  const [width, setWidth] = useState(Number.isFinite(savedWidth) ? Math.max(340, Math.min(520, savedWidth)) : 400);
  const [tab, setTab] = useState(tabs.includes(saved.tab) ? saved.tab : fallbackTab);
  const [collapsed, setCollapsed] = useState(Boolean(saved.collapsed));
  const [quickCardId, setQuickCardId] = useState(null);
  const dragRef = useRef(null);
  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify({ tab, collapsed, width })); }, [tab, collapsed, width, storageKey]);
  useEffect(() => { const move = (event) => { if (dragRef.current) setWidth(Math.max(340, Math.min(520, dragRef.current.width + dragRef.current.x - event.clientX))); }; const up = () => { dragRef.current = null; document.body.classList.remove("resizing-dnd-dock"); }; window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); }; }, []);
  const choose = (next) => { setTab(next); setCollapsed(false); };
  const labels = { character: "My Character", party: "Party", log: "Game Log", scenes: "Scenes", selection: "Selection" };
  const activeName = dashboard.turn_order?.[0]?.name || "";
  const quickCard = roster.find((card) => card.id === quickCardId);
  return <aside className={`table-sidebar${collapsed ? " collapsed" : ""}`} style={{ width: collapsed ? 64 : width }}>
    {!collapsed && <button type="button" className="dock-resize-handle" aria-label="Resize sidebar" title="Drag to resize sidebar" onPointerDown={(event) => { dragRef.current = { x: event.clientX, width }; document.body.classList.add("resizing-dnd-dock"); }} />}
    <nav aria-label="Table sidebar">
      <button type="button" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setCollapsed(!collapsed)}><SidebarIcon name={collapsed ? "expand" : "collapse"} /></button>
      {tabs.map((name) => <button type="button" className={tab === name ? "active" : ""} aria-label={labels[name]} title={labels[name]} aria-current={tab === name ? "page" : undefined} onClick={() => { choose(name); if (name !== "party") setQuickCardId(null); }} key={name}><SidebarIcon name={name} /></button>)}
      {!collapsed && <button type="button" className="dock-reset" aria-label="Reset sidebar width" title="Reset sidebar width" onClick={() => setWidth(400)}><SidebarIcon name="reset" /></button>}
    </nav>
    {!collapsed && <div className="sidebar-content">
      {tab === "character" && <MyCharacter card={cards[0]} request={request} refresh={refresh} reportError={reportError} onOpenSheet={onOpenSheet} onOpenLog={() => setTab("log")} />}
      {tab === "party" && (quickCard ? <QuickInspect card={quickCard} activeName={activeName} onBack={() => setQuickCardId(null)} onOpenSheet={onOpenSheet} /> : <PartyBrowser roster={roster} role={dashboard.role} activeName={activeName} onOpenSheet={isWarden ? setQuickCardId : onOpenSheet} />)}
      {tab === "log" && <GameLog cards={cards} rolls={rolls} role={dashboard.role} audience={audience} setAudience={setAudience} request={request} refresh={refresh} reportError={reportError} />}
      {tab === "scenes" && <SceneBrowser request={request} reportError={reportError} viewedSceneId={mapContext?.sceneId} />}
      {tab === "selection" && <section className="sidebar-pane selection-pane"><header><div><h2>Selection</h2><p>Contextual scene and token controls</p></div></header><div className="selection-scroll">{selectionPanel}</div></section>}
    </div>}
  </aside>;
}
