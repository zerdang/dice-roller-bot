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
    event?.preventDefault(); setError("");
    if (!actorId) { setError("Choose an authorized actor."); return; }
    try {
      const clean = expression.trim().replace(/^\/r\s+/i, "");
      await request(`/api/dnd/characters/${actorId}/rolls`, { method: "POST", body: JSON.stringify({ kind: "custom", label, expression: clean, mode: "normal", audience, operation_id: operationId() }) });
      await refresh(true);
    } catch (caught) { setError(caught.message || "Roll failed"); reportError(caught); }
  };
  return <section className="sidebar-pane log-pane"><header><div><h2>Game Log</h2><p>Authorized campaign rolls</p></div><label>Send to<select value={audience} onChange={(event) => setAudience(event.target.value)}><option value="public">Everyone</option><option value="private">Me + DM</option>{role === "warden" && <option value="dm">DM only</option>}</select></label></header><div className="log-scroll">{[...rolls].reverse().map((roll) => <details className={`log-card ${roll.audience !== "public" ? "private" : ""}`} key={roll.id}><summary><span className="actor-fallback">{roll.actor_name.slice(0, 1)}</span><span><b>{roll.actor_name}</b><small>{roll.label} · {new Date(roll.created_at).toLocaleString()}</small></span><strong>{roll.total}</strong></summary><div><span>{roll.expression}</span><span>Dice: {roll.dice.join(", ") || "—"}</span><span>Selected: {roll.selected.join(", ") || "—"}</span><span>{roll.mode}{roll.audience !== "public" ? ` · ${roll.audience}` : ""}</span></div></details>)}{!rolls.length && <p className="empty-state">Rolls from the sheet and composer will appear here.</p>}</div><form className="log-composer" onSubmit={submit}><div><select aria-label="Roll actor" value={actorId} onChange={(event) => setActorId(event.target.value)}>{cards.map((card) => <option value={card.id} key={card.id}>{card.name}</option>)}</select><input aria-label="Roll label" value={label} onChange={(event) => setLabel(event.target.value)} /></div><div><input aria-label="Dice expression" value={expression} onChange={(event) => setExpression(event.target.value)} placeholder="/r 1d20+4" /><button type="submit">Roll</button></div>{error && <p className="field-error">{error}</p>}<div className="dice-shortcuts">{dice.map((sides) => <button type="button" onClick={() => setExpression(`1d${sides}`)} key={sides}>d{sides}</button>)}</div></form></section>;
}

function TokenBrowser({ roster, templates, dashboard, onOpenSheet }) {
  const [query, setQuery] = useState("");
  const matches = (name) => name.toLowerCase().includes(query.toLowerCase());
  return <section className="sidebar-pane token-pane">
    <header><div><h2>Tokens</h2><p>Characters, templates and placed instances</p></div></header>
    <input className="sidebar-search" type="search" placeholder="Search tokens" value={query} onChange={(event) => setQuery(event.target.value)} />
    <div className="sidebar-scroll"><details open><summary>Players <span>{roster.length}</span></summary>{roster.filter((card) => matches(card.name)).map((card) => <article className="party-card" key={card.id}>
      <button type="button" className="party-identity" disabled={!card.can_open} onClick={() => card.can_open && onOpenSheet(card.id)}><span className="actor-fallback">{card.name.slice(0, 1)}</span><span><b>{card.name}</b><small>{[card.identity?.class_name, card.identity?.level ? `Level ${card.identity.level}` : ""].filter(Boolean).join(" · ") || (card.can_open ? "Open character sheet" : "Shared party summary")}</small></span></button>
      <div className="party-actions"><button type="button" onClick={() => window.dispatchEvent(new CustomEvent("dnd-center-character", { detail: card.id }))}>Locate</button>{card.can_open && <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("dnd-place-character", { detail: { id: card.id, name: card.name } }))}>Place</button>}{card.can_open && <button type="button" onClick={() => onOpenSheet(card.id)}>Sheet</button>}</div>
      <div className="party-stats"><span><b>{card.speed}</b>Speed</span><span><b>{card.armor_class}</b>Armor Class</span><span><b>{card.passives?.Perception ?? "—"}</b>Passive*</span><span><b>{card.hp}/{card.max_hp}</b>Hit Points</span></div>
      {card.conditions?.length > 0 && <p className="condition-summary">{card.conditions.map((item) => item.name).join(", ")}</p>}
    </article>)}</details>{dashboard.role === "warden" && <details open><summary>Reusable templates <span>{templates.length}</span></summary>{templates.filter((template) => matches(template.name)).map((template) => <article className="template-sidebar-row" key={template.id}><span className="actor-fallback">{template.name.slice(0, 1)}</span><div><b>{template.name}</b><small>{template.size} squares{template.armor_class != null ? ` · AC ${template.armor_class}` : ""}{template.hit_points != null ? ` · HP ${template.hit_points}` : ""}</small></div></article>)}</details>}</div>
    <p className="reference-footnote">* Reference-only passive value; no automatic adjudication.</p>
  </section>;
}

function SceneBrowser({ role, request, reportError }) {
  const [scenes, setScenes] = useState([]);
  const [folders, setFolders] = useState([]);
  const [query, setQuery] = useState("");
  const load = useCallback(async () => {
    try {
      const nextScenes = await request("/api/battlemap/scenes"); setScenes(nextScenes);
      if (role === "warden") setFolders(await request("/api/battlemap/scene-folders"));
    } catch (error) { reportError(error); }
  }, [request, role, reportError]);
  useEffect(() => { load(); }, [load]);
  const preview = (scene) => window.dispatchEvent(new CustomEvent("dnd-preview-scene", { detail: scene.id }));
  const activate = async (scene) => {
    if (!window.confirm(`Show ${scene.name} to all players?`)) return;
    try { await request(`/api/battlemap/scenes/${scene.id}`, { method: "PATCH", body: JSON.stringify({ revision: scene.revision, activate: true, operation_id: operationId() }) }); await load(); preview(scene); }
    catch (error) { reportError(error); }
  };
  const rows = (folderId) => scenes.filter((scene) => (scene.folder_id || null) === folderId && scene.name.toLowerCase().includes(query.toLowerCase()));
  const row = (scene) => <article className="scene-sidebar-row" key={scene.id}><button type="button" className="scene-name" onClick={() => preview(scene)}><b>{scene.name}</b><small>{scene.is_active ? "Players are here" : "Preview as DM"}</small></button>{role === "warden" && <><button type="button" onClick={() => preview(scene)}>Preview</button><button type="button" className={scene.is_active ? "active" : ""} disabled={scene.is_active} onClick={() => activate(scene)}>{scene.is_active ? "Live" : "Show"}</button></>}</article>;
  return <section className="sidebar-pane scene-pane"><header><div><h2>Scenes</h2><p>{role === "warden" ? "Preview locally or explicitly show to players" : "The DM controls scene changes"}</p></div></header><input className="sidebar-search" type="search" placeholder="Search scenes" value={query} onChange={(event) => setQuery(event.target.value)} /><div className="sidebar-scroll">{role === "warden" ? <>{folders.map((folder) => <details open key={folder.id}><summary>{folder.name} <span>{folder.scene_count}</span></summary>{rows(folder.id).map(row)}</details>)}<details open><summary>Unfiled</summary>{rows(null).map(row)}</details></> : scenes.map(row)}</div></section>;
}

export default function DndSidebar({ dashboard, cards, roster, rolls, audience, setAudience, request, refresh, reportError, onOpenSheet }) {
  const storageKey = `dnd-sidebar:${dashboard.campaign?.id || "campaign"}`;
  const saved = (() => { try { return JSON.parse(localStorage.getItem(storageKey) || "{}"); } catch { return {}; } })();
  const savedWidth = Number(saved.width);
  const initialWidth = Number.isFinite(savedWidth) ? Math.max(320, Math.min(520, savedWidth)) : 400;
  const [tab, setTab] = useState(saved.tab || "log");
  const [collapsed, setCollapsed] = useState(Boolean(saved.collapsed));
  const [templates, setTemplates] = useState([]);
  const asideRef = useRef(null);
  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify({ tab, collapsed, width: asideRef.current?.offsetWidth || saved.width || 400 })); }, [tab, collapsed, storageKey]);
  useEffect(() => {
    if (!asideRef.current || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (!collapsed) localStorage.setItem(storageKey, JSON.stringify({ tab, collapsed, width: Math.round(entry.contentRect.width) }));
    });
    observer.observe(asideRef.current); return () => observer.disconnect();
  }, [collapsed, storageKey, tab]);
  useEffect(() => {
    if (dashboard.role !== "warden") return;
    request("/api/battlemap/creature-templates").then(setTemplates).catch(reportError);
  }, [dashboard.role, request, reportError]);
  const choose = (next) => { setTab(next); setCollapsed(false); };
  return <aside ref={asideRef} className={`table-sidebar${collapsed ? " collapsed" : ""}`} style={{ width: collapsed ? 52 : initialWidth }}><nav aria-label="Table sidebar"><button type="button" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setCollapsed(!collapsed)}>‹</button><button type="button" className={tab === "log" ? "active" : ""} onClick={() => choose("log")}><span>☷</span><b>Game Log</b></button><button type="button" className={tab === "tokens" ? "active" : ""} onClick={() => choose("tokens")}><span>♟</span><b>Tokens</b></button><button type="button" className={tab === "scenes" ? "active" : ""} onClick={() => choose("scenes")}><span>▧</span><b>Scenes</b></button></nav>{!collapsed && <div className="sidebar-content">{tab === "log" && <GameLog cards={cards} rolls={rolls} role={dashboard.role} audience={audience} setAudience={setAudience} request={request} refresh={refresh} reportError={reportError} />}{tab === "tokens" && <TokenBrowser cards={cards} roster={roster} templates={templates} dashboard={dashboard} onOpenSheet={onOpenSheet} />}{tab === "scenes" && <SceneBrowser role={dashboard.role} request={request} reportError={reportError} />}</div>}</aside>;
}
