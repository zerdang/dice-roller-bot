import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export default function ReferenceBrowser({ request, isWarden, cards = [], onGrant }) {
  const [meta, setMeta] = useState(null);
  const [filters, setFilters] = useState({ q: "", kind: "", source: "", edition: "" });
  const [offset, setOffset] = useState(0);
  const [results, setResults] = useState({ items: [], total: 0 });
  const [entry, setEntry] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [policy, setPolicy] = useState([]);
  const [editingPolicy, setEditingPolicy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [menu, setMenu] = useState(null);
  const [targetId, setTargetId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [granting, setGranting] = useState(false);
  const [notice, setNotice] = useState("");
  const [hoverTip, setHoverTip] = useState(null);
  const [conditionTip, setConditionTip] = useState(null);
  const [conditions, setConditions] = useState({});
  const grantOperation = useRef(null);
  const menuRef = useRef(null);
  const detailRequest = useRef(0);
  const detailHeading = useRef(null);
  const launcher = useRef(null);
  const mounted = useRef(true);
  const hoverFetchTimer = useRef(null);
  const hoverHoldTimer = useRef(null);
  const hoverPinned = useRef(false);
  const hoverRequest = useRef(0);
  const hoverCache = useRef(new Map());
  const conditionFetchTimer = useRef(null);
  const conditionHoldTimer = useRef(null);
  const conditionPinned = useRef(false);
  const conditionRequest = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; detailRequest.current++; hoverRequest.current++; conditionRequest.current++; clearTimeout(hoverFetchTimer.current); clearTimeout(hoverHoldTimer.current); clearTimeout(conditionFetchTimer.current); clearTimeout(conditionHoldTimer.current); }; }, []);
  useEffect(() => {
    let active = true;
    request("/api/dnd/reference/meta").then(value => { if (active) setMeta(value); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [request]);
  useEffect(() => {
    if (!meta?.version) return undefined;
    let active = true;
    request("/api/dnd/reference?kind=condition&offset=0").then(value => {
      if (!active) return;
      const index = {};
      value.items.forEach(item => {
        const key = item.name.toLocaleLowerCase();
        if (!index[key] || item.edition === "2024") index[key] = item;
      });
      setConditions(index);
    }).catch(() => {});
    return () => { active = false; };
  }, [request, meta?.version]);
  useEffect(() => {
    if (!meta) return;
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      const query = new URLSearchParams({ ...filters, offset });
      request(`/api/dnd/reference?${query}`).then(value => {
        if (active) { setResults(value); setError(""); }
      }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [request, filters, offset, meta]);
  useEffect(() => { if (entry) detailHeading.current?.focus(); }, [entry]);
  useEffect(() => {
    if (!menu) return undefined;
    menuRef.current?.focus();
    const dismiss = event => { if (!menuRef.current?.contains(event.target)) setMenu(null); };
    const escape = event => { if (event.key === "Escape") setMenu(null); };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [menu]);
  useEffect(() => {
    const escape = event => { if (event.key === "Escape" && (hoverPinned.current || conditionPinned.current)) { closeCondition(true); closeHover(true); } };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  });
  const conditionPattern = useMemo(() => {
    const names = Object.values(conditions).map(item => item.name).sort((a, b) => b.length - a.length);
    return names.length ? new RegExp(`\\b(${names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "gi") : null;
  }, [conditions]);
  const filter = (key, value) => { setFilters(current => ({ ...current, [key]: value })); setOffset(0); };
  function closeCondition(force = false) {
    if (conditionPinned.current && !force) return;
    clearTimeout(conditionFetchTimer.current); clearTimeout(conditionHoldTimer.current);
    conditionRequest.current++; conditionPinned.current = false; setConditionTip(null);
  }
  function closeHover(force = false) {
    if (hoverPinned.current && !force) return;
    clearTimeout(hoverFetchTimer.current); clearTimeout(hoverHoldTimer.current);
    hoverRequest.current++; hoverPinned.current = false; setHoverTip(null); closeCondition(true);
  }
  const hideHover = () => closeHover(false);
  const showHover = (item, target) => {
    closeHover(true);
    const sequence = ++hoverRequest.current;
    const rect = target.getBoundingClientRect();
    const width = Math.min(380, window.innerWidth - 24);
    const left = rect.right + width + 10 <= window.innerWidth ? rect.right + 8 : Math.max(12, rect.left - width - 8);
    const top = Math.max(12, Math.min(rect.top, window.innerHeight - 260));
    const cached = hoverCache.current.get(item.id);
    setHoverTip({ item, entry: cached || null, loading: !cached, pinned: false, left, top, width });
    hoverHoldTimer.current = setTimeout(() => {
      if (sequence !== hoverRequest.current) return;
      hoverPinned.current = true;
      setHoverTip(current => current?.item.id === item.id ? { ...current, pinned: true } : current);
    }, 1500);
    if (!cached) hoverFetchTimer.current = setTimeout(async () => {
      try {
        const value = await request(`/api/dnd/reference/entries/${item.id}?version=${encodeURIComponent(results.version)}`);
        hoverCache.current.set(item.id, value);
        if (sequence === hoverRequest.current) setHoverTip(current => current?.item.id === item.id ? { ...current, entry: value, loading: false } : current);
      } catch {
        if (sequence === hoverRequest.current) closeHover(true);
      }
    }, 120);
  };
  const showCondition = (item, target) => {
    closeCondition(true);
    const sequence = ++conditionRequest.current;
    const rect = target.getBoundingClientRect();
    const width = Math.min(350, window.innerWidth - 24);
    const left = rect.right + width + 10 <= window.innerWidth ? rect.right + 8 : Math.max(12, rect.left - width - 8);
    const top = Math.max(12, Math.min(rect.top, window.innerHeight - 250));
    const cached = hoverCache.current.get(item.id);
    setConditionTip({ item, entry: cached || null, loading: !cached, pinned: false, left, top, width });
    conditionHoldTimer.current = setTimeout(() => {
      if (sequence !== conditionRequest.current) return;
      conditionPinned.current = true;
      setConditionTip(current => current?.item.id === item.id ? { ...current, pinned: true } : current);
    }, 1500);
    if (!cached) conditionFetchTimer.current = setTimeout(async () => {
      try {
        const value = await request(`/api/dnd/reference/entries/${item.id}?version=${encodeURIComponent(results.version)}`);
        hoverCache.current.set(item.id, value);
        if (sequence === conditionRequest.current) setConditionTip(current => current?.item.id === item.id ? { ...current, entry: value, loading: false } : current);
      } catch { if (sequence === conditionRequest.current) closeCondition(true); }
    }, 120);
  };
  const linkedDescription = text => {
    const clean = text.replace(/\s+/g, " ").trim().slice(0, 900);
    if (!conditionPattern) return clean;
    return clean.split(conditionPattern).map((part, index) => {
      const condition = conditions[part.toLocaleLowerCase()];
      return condition ? <button type="button" className="reference-important-term" key={`${part}-${index}`} onMouseEnter={event => showCondition(condition, event.currentTarget)} onMouseLeave={() => closeCondition(false)} onFocus={event => showCondition(condition, event.currentTarget)} onBlur={() => closeCondition(false)} onClick={event => { closeCondition(true); closeHover(true); open(condition, event.currentTarget); }}>{part}</button> : part;
    });
  };
  const open = async (item, target) => {
    launcher.current = target;
    const sequence = ++detailRequest.current;
    setError("");
    try {
      const value = await request(`/api/dnd/reference/entries/${item.id}?version=${encodeURIComponent(results.version)}`);
      if (sequence === detailRequest.current) setEntry(value);
    } catch (e) { if (sequence === detailRequest.current) setError(e.message); }
  };
  const openMenu = (event, item) => {
    event.preventDefault();
    grantOperation.current = crypto.randomUUID();
    setTargetId(""); setQuantity(1); setNotice("");
    setMenu({ item, x: Math.max(8, Math.min(event.clientX || 24, window.innerWidth - 310)),
              y: Math.max(8, Math.min(event.clientY || 24, window.innerHeight - 270)) });
  };
  const giveItem = async () => {
    const card = cards.find(value => value.id === Number(targetId));
    if (!card) { setError("Choose a character first."); return; }
    setGranting(true); setError("");
    try {
      await request(`/api/dnd/reference/entries/${menu.item.id}/grant`, { method: "POST", body: JSON.stringify({
        character_id: card.id, revision: card.revision, quantity: Number(quantity),
        version: results.version || meta.version, operation_id: grantOperation.current,
      }) });
      setNotice(`Added ${menu.item.name} to ${card.name}'s inventory.`); setMenu(null);
      await onGrant?.();
    } catch (e) { setError(e.message); }
    finally { setGranting(false); }
  };
  const savePolicy = async sources => {
    setSaving(true);
    try {
      const value = await request("/api/dnd/reference/policy", { method: "PUT", body: JSON.stringify({ sources }) });
      if (!mounted.current) return;
      setMeta(value); setPolicy([]); setEditingPolicy(false); setOffset(0); setFilters({ q: "", kind: "", source: "", edition: "" }); setError("");
    } catch (e) { if (mounted.current) setError(e.message); }
    finally { if (mounted.current) setSaving(false); }
  };
  return <section className="sidebar-pane reference-pane">
    <header><div><h2>Reference</h2><p>Classes, origins, spells, and rules</p></div>{entry && <><button type="button" onClick={e => openMenu(e, entry)}>Actions</button><button onClick={() => { setEntry(null); requestAnimationFrame(() => launcher.current?.focus()); }}>Back</button></>}</header>
    {error && <p role="alert" className="reference-error">{error}</p>}
    {notice && <p role="status" className="reference-notice">{notice}</p>}
    {hoverTip && createPortal(<aside id="reference-hover-description" className={`reference-hover-card${hoverTip.pinned ? " pinned" : ""}`} role="tooltip" style={{ left: hoverTip.left, top: hoverTip.top, width: hoverTip.width }}>
      <div className={`reference-hover-timer${hoverTip.pinned ? " complete" : ""}`} aria-label={hoverTip.pinned ? "Preview held open" : "Hold for 1.5 seconds to keep open"}><svg viewBox="0 0 32 32" aria-hidden="true"><circle className="timer-track" cx="16" cy="16" r="13" /><circle className="timer-progress" cx="16" cy="16" r="13" /></svg><span /></div>
      <header><strong>{hoverTip.item.name}</strong><span>{meta?.kinds?.[hoverTip.item.kind] || hoverTip.item.kind}</span>{hoverTip.pinned && <button type="button" aria-label="Close reference preview" onClick={() => closeHover(true)}>×</button>}</header>
      <small>{meta?.source_names?.[hoverTip.item.source] || hoverTip.item.source}{meta?.source_names?.[hoverTip.item.source] !== hoverTip.item.source ? ` (${hoverTip.item.source})` : ""}</small>
      {hoverTip.loading ? <p>Loading description…</p> : <p>{linkedDescription(hoverTip.entry?.text || "No standalone description is available. Open the entry for its structured details.")}{hoverTip.entry?.text?.length > 900 ? "…" : ""}</p>}
      <em>{hoverTip.pinned ? "Underlined terms open linked rules. Press Escape to close." : "Keep hovering until the ring fills to interact."}</em>
    </aside>, document.body)}
    {conditionTip && createPortal(<aside className={`reference-hover-card reference-condition-card${conditionTip.pinned ? " pinned" : ""}`} role="tooltip" style={{ left: conditionTip.left, top: conditionTip.top, width: conditionTip.width }}>
      <div className={`reference-hover-timer${conditionTip.pinned ? " complete" : ""}`} aria-label={conditionTip.pinned ? "Condition preview held open" : "Hold for 1.5 seconds to keep open"}><svg viewBox="0 0 32 32" aria-hidden="true"><circle className="timer-track" cx="16" cy="16" r="13" /><circle className="timer-progress" cx="16" cy="16" r="13" /></svg><span /></div>
      <header><strong>{conditionTip.item.name}</strong><span>Condition</span>{conditionTip.pinned && <button type="button" aria-label="Close condition preview" onClick={() => closeCondition(true)}>×</button>}</header>
      <small>{meta?.source_names?.[conditionTip.item.source] || conditionTip.item.source}</small>
      {conditionTip.loading ? <p>Loading condition…</p> : <p>{linkedDescription(conditionTip.entry?.text || "Open the condition for complete rules.")}{conditionTip.entry?.text?.length > 900 ? "…" : ""}</p>}
      <em>Click the underlined term for the complete condition entry.</em>
    </aside>, document.body)}
    <div className="reference-scroll" hidden={Boolean(entry)}>
      <label>Search<input type="search" placeholder="Name or rules text…" value={filters.q} onChange={e => filter("q", e.target.value)} /></label>
      <div className="reference-filters">
        <label>Category<select value={filters.kind} onChange={e => filter("kind", e.target.value)}><option value="">All categories</option>{Object.entries(meta?.kinds || {}).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Rules edition<select value={filters.edition} onChange={e => filter("edition", e.target.value)}><option value="">All editions</option>{meta?.editions.map(value => <option key={value} value={value}>{value === "unspecified" ? "Not specified" : value}</option>)}</select></label>
        <label>Source<select value={filters.source} onChange={e => filter("source", e.target.value)}><option value="">All enabled sources</option>{meta?.sources.map(value => <option key={value} value={value}>{meta.source_names?.[value] || value} ({value})</option>)}</select></label>
      </div>
      {isWarden && meta && <details><summary>Campaign reference sources</summary><p>Choose which books and adventures everyone in this campaign can search.</p><div className="reference-source-list"><table><colgroup><col className="source-enabled-column" /><col /><col className="source-code-column" /></colgroup><thead><tr><th>Use</th><th>Full source name</th><th>Code</th></tr></thead><tbody>{meta.all_sources.map(source => { const enabled = editingPolicy ? policy.includes(source) : meta.allowed_sources === null || meta.allowed_sources.includes(source); return <tr className={enabled ? "selected" : ""} key={source}><td><input type="checkbox" aria-label={`${enabled ? "Disable" : "Enable"} ${meta.source_names?.[source] || source}`} checked={enabled} disabled={!editingPolicy} onChange={e => setPolicy(current => e.target.checked ? [...current, source] : current.filter(item => item !== source))} /></td><th scope="row">{meta.source_names?.[source] || source}</th><td><code>{source}</code></td></tr>; })}</tbody></table></div><div className="reference-policy-actions">{editingPolicy ? <><button disabled={saving} onClick={() => savePolicy(policy)}>Save selection</button><button disabled={saving} onClick={() => savePolicy(null)}>Allow all sources</button><button disabled={saving} onClick={() => { setPolicy([]); setEditingPolicy(false); }}>Cancel</button></> : <button onClick={() => { setPolicy(meta.allowed_sources ?? meta.all_sources); setEditingPolicy(true); }}>Edit enabled sources</button>}</div></details>}
      {!meta ? <p>Loading reference library…</p> : !meta.version ? <p>The reference library has not been loaded yet. Ask your DM to set it up.</p> : <>
        <p role="status">{loading ? "Searching…" : `${results.total.toLocaleString()} results`}</p>
        <div className="reference-result-list" aria-busy={loading}><table className="reference-result-table"><colgroup><col className="result-name-column" /><col className="result-category-column" /><col /></colgroup><thead><tr><th>Name</th><th>Category</th><th>Full source name</th></tr></thead><tbody>{results.items.map(item => <tr key={item.id} onMouseEnter={e => showHover(item, e.currentTarget)} onMouseLeave={hideHover} onFocus={e => showHover(item, e.currentTarget)} onBlur={hideHover} onContextMenu={e => { hideHover(); openMenu(e, item); }}><th scope="row"><button type="button" onClick={e => { hideHover(); open(item, e.currentTarget); }} onKeyDown={e => { if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) { hideHover(); openMenu(e, item); } }} aria-describedby={hoverTip?.item.id === item.id ? "reference-hover-description" : undefined} aria-label={`${item.name}; hover for a description, open details, or use the context menu for actions`}>{item.name}</button>{item.warnings.length > 0 && <small>Source review needed</small>}</th><td>{meta.kinds[item.kind]}</td><td><span>{meta.source_names?.[item.source] || item.source}</span><small>{item.source}</small></td></tr>)}</tbody></table></div>
        {!loading && results.total === 0 && <p>No matching entries. Try another name or clear a filter.</p>}
        <nav className="reference-pagination" aria-label="Reference results pages"><button disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 30))}>Previous</button><span>Page {Math.floor(offset / 30) + 1}</span><button disabled={loading || offset + 30 >= results.total} onClick={() => setOffset(offset + 30)}>Next</button></nav>
      </>}
    </div>
    {entry && <article className="reference-scroll reference-detail" onContextMenu={e => openMenu(e, entry)}><h3 ref={detailHeading} tabIndex={-1}>{entry.name}</h3><p>{meta?.source_names?.[entry.source] || entry.source} ({entry.source}){entry.page ? ` · p. ${entry.page}` : ""} · {entry.edition === "unspecified" ? "Edition unspecified" : entry.edition}</p>{entry.warnings.map((warning, i) => <p className="reference-warning" key={i}>{warning}</p>)}<div className="reference-text">{entry.text || "No standalone description. Consult the source entry."}</div><p className="reference-footnote">Reference entry. Character-building automation is not available yet.</p></article>}
    {menu && <div className="reference-context-menu" ref={menuRef} tabIndex={-1} role="menu" aria-label={`Actions for ${menu.item.name}`} style={{ left: menu.x, top: menu.y }} onContextMenu={e => e.preventDefault()}>
      <strong>{menu.item.name}</strong>
      <button type="button" role="menuitem" onClick={() => { setMenu(null); open(menu.item, launcher.current); }}>View details</button>
      <button type="button" role="menuitem" onClick={() => { navigator.clipboard?.writeText(menu.item.name).then(() => setNotice("Name copied."), e => setError(e.message)); setMenu(null); }}>Copy name</button>
      {isWarden && ["item", "baseitem"].includes(menu.item.kind) && <div className="reference-grant"><label>Give to character<select value={targetId} onChange={e => { setTargetId(e.target.value); grantOperation.current = crypto.randomUUID(); }}><option value="">Choose player</option>{cards.map(card => <option key={card.id} value={card.id}>{card.name}</option>)}</select></label><label>Quantity<input type="number" min="1" max="99" value={quantity} onChange={e => { setQuantity(e.target.value); grantOperation.current = crypto.randomUUID(); }} /></label><button type="button" disabled={granting || !targetId || !Number.isInteger(Number(quantity)) || Number(quantity) < 1 || Number(quantity) > 99} onClick={giveItem}>{granting ? "Giving…" : "Add to inventory"}</button></div>}
    </div>}
  </section>;
}
