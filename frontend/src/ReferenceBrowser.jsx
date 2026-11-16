import { useEffect, useRef, useState } from "react";
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
  const grantOperation = useRef(null);
  const menuRef = useRef(null);
  const detailRequest = useRef(0);
  const detailHeading = useRef(null);
  const launcher = useRef(null);
  const mounted = useRef(true);
  const hoverTimer = useRef(null);
  const hoverRequest = useRef(0);
  const hoverCache = useRef(new Map());
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; detailRequest.current++; hoverRequest.current++; clearTimeout(hoverTimer.current); }; }, []);
  useEffect(() => {
    let active = true;
    request("/api/dnd/reference/meta").then(value => { if (active) setMeta(value); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [request]);
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
  const filter = (key, value) => { setFilters(current => ({ ...current, [key]: value })); setOffset(0); };
  const hideHover = () => { clearTimeout(hoverTimer.current); hoverRequest.current++; setHoverTip(null); };
  const showHover = (item, target) => {
    clearTimeout(hoverTimer.current);
    const sequence = ++hoverRequest.current;
    const rect = target.getBoundingClientRect();
    const width = Math.min(380, window.innerWidth - 24);
    const left = rect.right + width + 10 <= window.innerWidth ? rect.right + 8 : Math.max(12, rect.left - width - 8);
    const top = Math.max(12, Math.min(rect.top, window.innerHeight - 260));
    hoverTimer.current = setTimeout(async () => {
      const cached = hoverCache.current.get(item.id);
      setHoverTip({ item, entry: cached || null, loading: !cached, left, top, width });
      if (cached) return;
      try {
        const value = await request(`/api/dnd/reference/entries/${item.id}?version=${encodeURIComponent(results.version)}`);
        hoverCache.current.set(item.id, value);
        if (sequence === hoverRequest.current) setHoverTip({ item, entry: value, loading: false, left, top, width });
      } catch {
        if (sequence === hoverRequest.current) setHoverTip(null);
      }
    }, 280);
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
    {hoverTip && createPortal(<aside id="reference-hover-description" className="reference-hover-card" role="tooltip" style={{ left: hoverTip.left, top: hoverTip.top, width: hoverTip.width }}>
      <header><strong>{hoverTip.item.name}</strong><span>{meta?.kinds?.[hoverTip.item.kind] || hoverTip.item.kind}</span></header>
      <small>{meta?.source_names?.[hoverTip.item.source] || hoverTip.item.source}{meta?.source_names?.[hoverTip.item.source] !== hoverTip.item.source ? ` (${hoverTip.item.source})` : ""}</small>
      {hoverTip.loading ? <p>Loading description…</p> : <p>{(hoverTip.entry?.text || "No standalone description is available. Open the entry for its structured details.").replace(/\s+/g, " ").trim().slice(0, 900)}{hoverTip.entry?.text?.length > 900 ? "…" : ""}</p>}
      <em>Click the name for complete details.</em>
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
