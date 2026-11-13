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
      await refresh(true);
    } catch (caught) { setError(caught.message || "Roll failed"); reportError(caught); }
  };
  return <section className="sidebar-pane log-pane"><header><div><h2>Game Log</h2><p>Recent campaign rolls</p></div><label>Audience<select value={audience} onChange={(event) => setAudience(event.target.value)}><option value="public">Everyone</option><option value="private">Me + DM</option>{role === "warden" && <option value="dm">DM only</option>}</select></label></header><div className="log-scroll">{[...rolls].reverse().map((roll) => <details className={`log-card ${roll.audience !== "public" ? "private" : ""}`} key={roll.id}><summary><span className="actor-fallback">{roll.actor_name.slice(0, 1)}</span><span><b>{roll.actor_name}</b><small>{roll.label} · {new Date(roll.created_at).toLocaleString()}</small>{roll.audience !== "public" && <em className="audience-label">{roll.audience === "dm" ? "DM only" : "Private"}</em>}</span><strong>{roll.total}</strong></summary><div><span>{roll.expression}</span><span>Dice: {roll.dice.join(", ") || "—"}</span><span>Selected: {roll.selected.join(", ") || "—"}</span><span>{roll.mode}</span></div></details>)}{!rolls.length && <p className="empty-state">Rolls from the sheet and composer will appear here.</p>}</div><form className="log-composer" onSubmit={submit}>{role === "warden" ? <div><select aria-label="Roll actor" value={actorId} onChange={(event) => setActorId(event.target.value)}>{cards.map((card) => <option value={card.id} key={card.id}>{card.name}</option>)}</select><input aria-label="Roll label" value={label} onChange={(event) => setLabel(event.target.value)} /></div> : <label className="composer-label">Roll label<input value={label} onChange={(event) => setLabel(event.target.value)} /></label>}<div><input aria-label="Dice expression" value={expression} onChange={(event) => setExpression(event.target.value)} placeholder="1d20+4" /><button type="submit">Roll</button></div>{error && <p className="field-error">{error}</p>}<div className="dice-shortcuts">{dice.map((sides) => <button type="button" onClick={() => setExpression(`1d${sides}`)} key={sides}>d{sides}</button>)}</div></form></section>;
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

function SceneBrowser({ request, reportError }) {
  const [scenes, setScenes] = useState([]); const [folders, setFolders] = useState([]); const [query, setQuery] = useState("");
  const load = useCallback(async () => { try { setScenes(await request("/api/battlemap/scenes")); setFolders(await request("/api/battlemap/scene-folders")); } catch (error) { reportError(error); } }, [request, reportError]);
  useEffect(() => { load(); }, [load]);
  const preview = (scene) => window.dispatchEvent(new CustomEvent("dnd-preview-scene", { detail: scene.id }));
  const activate = async (scene) => { if (!window.confirm(`Show ${scene.name} to all players?`)) return; try { await request(`/api/battlemap/scenes/${scene.id}`, { method: "PATCH", body: JSON.stringify({ revision: scene.revision, activate: true, operation_id: operationId() }) }); await load(); preview(scene); } catch (error) { reportError(error); } };
  const rows = (folderId) => scenes.filter((scene) => (scene.folder_id || null) === folderId && scene.name.toLowerCase().includes(query.toLowerCase()));
  const row = (scene) => <article className={`scene-sidebar-row${scene.is_active ? " live" : ""}`} key={scene.id}><button type="button" className="scene-name" onClick={() => preview(scene)}><b>{scene.name}</b><small>{scene.is_active ? "LIVE — visible to players" : "Preview privately"}</small></button><button type="button" onClick={() => preview(scene)}>Preview</button><button type="button" className={scene.is_active ? "active" : "show-scene"} disabled={scene.is_active} onClick={() => activate(scene)}>{scene.is_active ? "Live" : "Show"}</button></article>;
  return <section className="sidebar-pane scene-pane"><header><div><h2>Scenes</h2><p>Preview privately, then explicitly show players</p></div></header><input className="sidebar-search" type="search" placeholder="Search scenes" value={query} onChange={(event) => setQuery(event.target.value)} /><div className="sidebar-scroll">{folders.map((folder) => <details open key={folder.id}><summary>{folder.name} <span>{folder.scene_count}</span></summary>{rows(folder.id).map(row)}</details>)}<details open><summary>Unfiled</summary>{rows(null).map(row)}</details></div></section>;
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

export default function DndSidebar({ dashboard, cards, roster, rolls, audience, setAudience, request, refresh, reportError, onOpenSheet, selectionPanel }) {
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
  const labels = { character: ["ME", "My Character"], party: ["PC", "Party"], log: ["LOG", "Game Log"], scenes: ["MAP", "Scenes"], selection: ["EDIT", "Selection"] };
  const activeName = dashboard.turn_order?.[0]?.name || "";
  const quickCard = roster.find((card) => card.id === quickCardId);
  return <aside className={`table-sidebar${collapsed ? " collapsed" : ""}`} style={{ width: collapsed ? 64 : width }}>
    {!collapsed && <button type="button" className="dock-resize-handle" aria-label="Resize sidebar" title="Drag to resize sidebar" onPointerDown={(event) => { dragRef.current = { x: event.clientX, width }; document.body.classList.add("resizing-dnd-dock"); }} />}
    <nav aria-label="Table sidebar">
      <button type="button" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setCollapsed(!collapsed)}><span aria-hidden="true">{collapsed ? "‹" : "›"}</span><b>{collapsed ? "Open" : "Close"}</b></button>
      {tabs.map((name) => <button type="button" className={tab === name ? "active" : ""} aria-current={tab === name ? "page" : undefined} onClick={() => { choose(name); if (name !== "party") setQuickCardId(null); }} key={name}><span aria-hidden="true">{labels[name][0]}</span><b>{labels[name][1]}</b></button>)}
      {!collapsed && <button type="button" className="dock-reset" onClick={() => setWidth(400)}><span aria-hidden="true">↔</span><b>Reset</b></button>}
    </nav>
    {!collapsed && <div className="sidebar-content">
      {tab === "character" && <MyCharacter card={cards[0]} request={request} refresh={refresh} reportError={reportError} onOpenSheet={onOpenSheet} onOpenLog={() => setTab("log")} />}
      {tab === "party" && (quickCard ? <QuickInspect card={quickCard} activeName={activeName} onBack={() => setQuickCardId(null)} onOpenSheet={onOpenSheet} /> : <PartyBrowser roster={roster} role={dashboard.role} activeName={activeName} onOpenSheet={isWarden ? setQuickCardId : onOpenSheet} />)}
      {tab === "log" && <GameLog cards={cards} rolls={rolls} role={dashboard.role} audience={audience} setAudience={setAudience} request={request} refresh={refresh} reportError={reportError} />}
      {tab === "scenes" && <SceneBrowser request={request} reportError={reportError} />}
      {tab === "selection" && <section className="sidebar-pane selection-pane"><header><div><h2>Selection</h2><p>Contextual scene and token controls</p></div></header><div className="selection-scroll">{selectionPanel}</div></section>}
    </div>}
  </aside>;
}
