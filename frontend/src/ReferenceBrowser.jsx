import { useEffect, useRef, useState } from "react";

export default function ReferenceBrowser({ request, isWarden }) {
  const [meta, setMeta] = useState(null);
  const [filters, setFilters] = useState({ q: "", kind: "", source: "", edition: "" });
  const [offset, setOffset] = useState(0);
  const [results, setResults] = useState({ items: [], total: 0 });
  const [entry, setEntry] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [policy, setPolicy] = useState(null);
  const [saving, setSaving] = useState(false);
  const detailRequest = useRef(0);
  const detailHeading = useRef(null);
  const launcher = useRef(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; detailRequest.current++; }; }, []);
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
  const filter = (key, value) => { setFilters(current => ({ ...current, [key]: value })); setOffset(0); };
  const open = async (item, target) => {
    launcher.current = target;
    const sequence = ++detailRequest.current;
    setError("");
    try {
      const value = await request(`/api/dnd/reference/entries/${item.id}?version=${encodeURIComponent(results.version)}`);
      if (sequence === detailRequest.current) setEntry(value);
    } catch (e) { if (sequence === detailRequest.current) setError(e.message); }
  };
  const savePolicy = async sources => {
    setSaving(true);
    try {
      const value = await request("/api/dnd/reference/policy", { method: "PUT", body: JSON.stringify({ sources }) });
      if (!mounted.current) return;
      setMeta(value); setPolicy(null); setOffset(0); setFilters({ q: "", kind: "", source: "", edition: "" }); setError("");
    } catch (e) { if (mounted.current) setError(e.message); }
    finally { if (mounted.current) setSaving(false); }
  };
  return <section className="sidebar-pane reference-pane">
    <header><div><h2>Reference</h2><p>Classes, origins, spells, and rules</p></div>{entry && <button onClick={() => { setEntry(null); requestAnimationFrame(() => launcher.current?.focus()); }}>Back</button>}</header>
    {error && <p role="alert" className="reference-error">{error}</p>}
    <div className="reference-scroll" hidden={Boolean(entry)}>
      <label>Search<input type="search" placeholder="Name or rules text…" value={filters.q} onChange={e => filter("q", e.target.value)} /></label>
      <div className="reference-filters">
        <label>Category<select value={filters.kind} onChange={e => filter("kind", e.target.value)}><option value="">All categories</option>{Object.entries(meta?.kinds || {}).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Rules edition<select value={filters.edition} onChange={e => filter("edition", e.target.value)}><option value="">All editions</option>{meta?.editions.map(value => <option key={value} value={value}>{value === "unspecified" ? "Not specified" : value}</option>)}</select></label>
        <label>Source<select value={filters.source} onChange={e => filter("source", e.target.value)}><option value="">All enabled sources</option>{meta?.sources.map(value => <option key={value}>{value}</option>)}</select></label>
      </div>
      {isWarden && meta && <details><summary>Campaign reference sources</summary><p>Applies to reference access for everyone in this campaign.</p>{policy === null ? <button onClick={() => setPolicy(meta.allowed_sources ?? meta.all_sources)}>Choose sources</button> : <><div className="reference-source-list">{meta.all_sources.map(source => <label key={source}><input type="checkbox" checked={policy.includes(source)} onChange={e => setPolicy(current => e.target.checked ? [...current, source] : current.filter(item => item !== source))} />{source}</label>)}</div><div className="reference-policy-actions"><button disabled={saving} onClick={() => savePolicy(policy)}>Save selection</button><button disabled={saving} onClick={() => savePolicy(null)}>Allow all sources</button><button disabled={saving} onClick={() => setPolicy(null)}>Cancel</button></div></>}</details>}
      {!meta ? <p>Loading reference library…</p> : !meta.version ? <p>The reference library has not been loaded yet. Ask your DM to set it up.</p> : <>
        <p role="status">{loading ? "Searching…" : `${results.total.toLocaleString()} results`}</p>
        <div className="reference-results" aria-busy={loading}>{results.items.map(item => <button key={item.id} onClick={e => open(item, e.currentTarget)}><strong>{item.name}</strong><span>{meta.kinds[item.kind]} · {item.source} · {item.edition === "unspecified" ? "Edition unspecified" : item.edition}{item.page ? ` · p. ${item.page}` : ""}</span>{item.warnings.length > 0 && <small>Source review needed</small>}</button>)}</div>
        {!loading && results.total === 0 && <p>No matching entries. Try another name or clear a filter.</p>}
        <nav className="reference-pagination" aria-label="Reference results pages"><button disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 30))}>Previous</button><span>Page {Math.floor(offset / 30) + 1}</span><button disabled={loading || offset + 30 >= results.total} onClick={() => setOffset(offset + 30)}>Next</button></nav>
      </>}
    </div>
    {entry && <article className="reference-scroll reference-detail"><h3 ref={detailHeading} tabIndex={-1}>{entry.name}</h3><p>{entry.source}{entry.page ? ` · p. ${entry.page}` : ""} · {entry.edition === "unspecified" ? "Edition unspecified" : entry.edition}</p>{entry.warnings.map((warning, i) => <p className="reference-warning" key={i}>{warning}</p>)}<div className="reference-text">{entry.text || "No standalone description. Consult the source entry."}</div><p className="reference-footnote">Reference entry. Character-building automation is not available yet.</p></article>}
  </section>;
}
