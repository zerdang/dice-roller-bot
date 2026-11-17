import { useEffect, useState } from "react";

const METHODS = {
  array: "Standard array",
  point_buy: "Point buy",
  rolled: "Recorded rolls",
  manual: "Manual entry",
};

export default function CampaignSettings({ request, reportError }) {
  const [creation, setCreation] = useState(null);
  const [meta, setMeta] = useState(null);
  const [sources, setSources] = useState([]);
  const [saving, setSaving] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([request("/api/dnd/creation/settings"), request("/api/dnd/reference/meta")])
      .then(([creationValue, metaValue]) => {
        if (!active) return;
        setCreation(creationValue);
        setMeta(metaValue);
        setSources(metaValue.allowed_sources ?? metaValue.all_sources ?? []);
      })
      .catch(reportError);
    return () => { active = false; };
  }, [request, reportError]);

  const saveCreation = async () => {
    if (!creation?.methods.length) return;
    setSaving("creation"); setNotice("");
    try {
      const value = await request("/api/dnd/creation/settings", { method: "PUT", body: JSON.stringify(creation) });
      setCreation(value); setNotice("Character creation settings now apply to the campaign.");
    } catch (error) { reportError(error); }
    finally { setSaving(""); }
  };

  const saveSources = async allowed => {
    setSaving("sources"); setNotice("");
    try {
      const value = await request("/api/dnd/reference/policy", { method: "PUT", body: JSON.stringify({ sources: allowed }) });
      setMeta(value); setSources(value.allowed_sources ?? value.all_sources ?? []);
      setNotice(allowed === null ? "All reference sources are enabled campaign-wide." : "Reference sources updated for every player.");
    } catch (error) { reportError(error); }
    finally { setSaving(""); }
  };

  if (!creation || !meta) return <section className="sidebar-pane settings-pane"><header><div><h2>Campaign Settings</h2><p>Loading global configuration</p></div></header></section>;
  return <section className="sidebar-pane settings-pane">
    <header><div><h2>Campaign Settings</h2><p>Global rules for this campaign and its players</p></div></header>
    <div className="sidebar-scroll campaign-settings-scroll">
      {notice && <p className="reference-notice" role="status">{notice}</p>}
      <section><h3>Character creation</h3><p>These choices apply to every current and future character draft in this campaign.</p>
        <fieldset><legend>Allowed ability-score methods</legend><div className="campaign-setting-checks">{Object.entries(METHODS).map(([method, label]) => <label key={method}><input type="checkbox" checked={creation.methods.includes(method)} onChange={event => setCreation(current => ({ ...current, methods: event.target.checked ? [...current.methods, method] : current.methods.filter(value => value !== method) }))} />{label}</label>)}</div></fieldset>
        <label className="campaign-setting-toggle"><input type="checkbox" checked={creation.flexible_background_abilities} onChange={event => setCreation(current => ({ ...current, flexible_background_abilities: event.target.checked }))} /><span><strong>Unrestricted ability increases</strong><small>Enabled by default. Allocate 3 points across any abilities, regardless of species or background, with at most +2 per ability.</small></span></label>
        <label className="campaign-setting-toggle"><input type="checkbox" checked={creation.manual_review_required} onChange={event => setCreation(current => ({ ...current, manual_review_required: event.target.checked }))} /><span><strong>Require DM character review</strong><small>When off, players can submit completed drafts directly as playable characters under their own control.</small></span></label>
        <button type="button" disabled={saving === "creation" || !creation.methods.length} onClick={saveCreation}>{saving === "creation" ? "Saving…" : "Save character settings"}</button>
      </section>
      <section><h3>Reference sources</h3><p>Enabled sources are searchable and selectable by everyone in this campaign.</p>
        <div className="reference-source-list campaign-source-list"><table data-table-id="campaign-reference-sources"><colgroup><col className="source-enabled-column" /><col /><col className="source-code-column" /></colgroup><thead><tr><th>Use</th><th>Full source name</th><th>Code</th></tr></thead><tbody>{meta.all_sources.map(source => <tr className={sources.includes(source) ? "selected" : ""} key={source}><td><input type="checkbox" aria-label={`Enable ${meta.source_names?.[source] || source}`} checked={sources.includes(source)} onChange={event => setSources(current => event.target.checked ? [...current, source] : current.filter(value => value !== source))} /></td><th scope="row">{meta.source_names?.[source] || source}</th><td><code>{source}</code></td></tr>)}</tbody></table></div>
        <div className="reference-policy-actions"><button type="button" disabled={saving === "sources"} onClick={() => saveSources(sources)}>Save enabled sources</button><button type="button" disabled={saving === "sources"} onClick={() => saveSources(null)}>Allow all sources</button></div>
      </section>
    </div>
  </section>;
}
