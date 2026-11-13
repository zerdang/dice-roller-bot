import { useEffect, useRef, useState } from "react";

const ABILITIES = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];
const STEPS = [["class", "Class"], ["origin", "Origin"], ["abilities", "Abilities"], ["training", "Skills"], ["features", "Features"], ["equipment", "Equipment"], ["spells", "Spells"], ["portrait", "Portrait"], ["review", "Review"]];
const METHODS = { array: "Standard array", point_buy: "Point buy", rolled: "Recorded rolls", manual: "Manual entry" };
const ARRAY = [15, 14, 13, 12, 10, 8];
const COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
const title = text => text.replace(/\b\w/g, c => c.toUpperCase());
const signed = n => n >= 0 ? `+${n}` : String(n);

function CatalogChoice({ request, draftId, kind, label, selected, onSelect, version, multiple = false }) {
  const [query, setQuery] = useState("");
  const [edition, setEdition] = useState("");
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null);
  const detailSequence = useRef(0);
  useEffect(() => () => { detailSequence.current++; }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      request(`/api/dnd/creation/drafts/${draftId}/options?${new URLSearchParams({ kind, q: query, edition, offset })}`)
        .then(value => { if (active) { setResult(value); setError(""); } })
        .catch(e => { if (active) setError(e.message); })
        .finally(() => { if (active) setLoading(false); });
    }, 180);
    return () => { active = false; clearTimeout(timer); };
  }, [request, draftId, kind, query, edition, offset]);
  const inspect = async item => {
    const seq = ++detailSequence.current;
    try {
      const value = await request(`/api/dnd/reference/entries/${item.id}?version=${encodeURIComponent(version)}`);
      if (seq === detailSequence.current) setDetail(value);
    } catch (e) { if (seq === detailSequence.current) setError(e.message); }
  };
  return <section className="builder-choice"><h3>{label}</h3>
    <div className="builder-search"><label>Search {label.toLowerCase()}<input type="search" value={query} onChange={e => { setQuery(e.target.value); setOffset(0); }} placeholder="Search names and descriptions" /></label><label>Rules edition<select value={edition} onChange={e => { setEdition(e.target.value); setOffset(0); }}><option value="">All editions</option><option value="2024">2024</option><option value="2014">2014</option><option value="unspecified">Unspecified</option></select></label></div>
    {error && <p role="alert">{error}</p>}
    <p role="status">{loading ? "Searching…" : `${result.total} choices`}</p>
    <div className="builder-options" aria-busy={loading}>{result.items.map(item => { const picked = multiple ? selected.includes(item.id) : selected === item.id; return <article className={picked ? "selected" : ""} key={item.id}><div><strong>{item.name}</strong><small>{item.source} · {item.edition === "unspecified" ? "Edition unspecified" : item.edition}{item.warnings.length > 0 ? " · Requires source review" : ""}</small></div><button type="button" onClick={() => inspect(item)} aria-label={`Details for ${item.name} from ${item.source}`}>Details</button><button type="button" aria-pressed={picked} onClick={() => onSelect(item.id)} aria-label={`${picked && multiple ? "Remove" : "Select"} ${item.name} from ${item.source}`}>{picked ? multiple ? "Remove" : "Selected" : "Select"}</button></article>; })}</div>
    {!loading && !result.total && <p>No matching choices are enabled in this campaign.</p>}
    <nav className="builder-pagination" aria-label={`${label} pages`}><button disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 30))}>Previous</button><span>Page {Math.floor(offset / 30) + 1}</span><button disabled={loading || offset + 30 >= result.total} onClick={() => setOffset(offset + 30)}>Next</button></nav>
    {detail && <section className="builder-source" aria-label={`${detail.name} details`}><header><h4>{detail.name} · {detail.source}</h4><button onClick={() => setDetail(null)}>Close details</button></header>{detail.warnings.map((warning, i) => <p key={i}>{warning}</p>)}<div>{detail.text || "Consult the source for this option's complete traits."}</div></section>}
  </section>;
}

function DraftEditor({ initial, request, onBack, isWarden, onFinalized }) {
  const [draft, setDraft] = useState(initial.draft);
  const [preview, setPreview] = useState(initial.preview);
  const [saved, setSaved] = useState(JSON.stringify(initial.draft));
  const [status, setStatus] = useState("Saved");
  const [error, setError] = useState("");
  const [step, setStep] = useState("class");
  const [rolling, setRolling] = useState(false);
  const [settings, setSettings] = useState(null);
  const [policyBusy, setPolicyBusy] = useState(false);
  const [finalizedId, setFinalizedId] = useState(initial.finalized_character_id || null);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [portraitUrl, setPortraitUrl] = useState(initial.portrait_url || "");
  const [portraitBusy, setPortraitBusy] = useState(false);
  const revision = useRef(initial.revision);
  const queue = useRef(Promise.resolve());
  const blocked = useRef(false);
  const alive = useRef(true);
  const current = useRef(draft);
  const savedRef = useRef(saved);
  const dialog = useRef(null);
  const latest = JSON.stringify(draft);
  current.current = draft;
  const dirty = latest !== saved;
  useEffect(() => { alive.current = true; dialog.current?.focus(); return () => { alive.current = false; }; }, []);
  const apply = (key, value) => setDraft(old => ({ ...old, [key]: value }));
  const saveSnapshot = snapshot => {
    queue.current = queue.current.then(async () => {
      if (blocked.current) throw new Error("Reload the draft to resolve the save error.");
      if (snapshot === savedRef.current) return;
      if (alive.current) setStatus("Saving…");
      try {
        const response = await request(`/api/dnd/creation/drafts/${initial.id}`, { method: "PUT", body: JSON.stringify({ revision: revision.current, draft: JSON.parse(snapshot) }) });
        revision.current = response.revision;
        savedRef.current = snapshot;
        if (alive.current) {
          setSaved(snapshot); setStatus("Saved"); setError("");
          if (JSON.stringify(current.current) === snapshot) setPreview(response.preview);
        }
      } catch (e) {
        blocked.current = true;
        if (alive.current) { setStatus("Not saved"); setError(e.message); }
        throw e;
      }
    });
    // Recover the queue itself, while returning a rejecting task to explicit callers.
    const task = queue.current;
    queue.current = task.catch(() => {});
    return task;
  };
  useEffect(() => {
    if (latest === savedRef.current || blocked.current) return;
    setStatus("Unsaved changes");
    const timer = setTimeout(() => { saveSnapshot(latest).catch(() => {}); }, 650);
    return () => clearTimeout(timer);
  }, [latest]);
  useEffect(() => {
    const beforeUnload = e => { if (JSON.stringify(current.current) !== savedRef.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);
  const close = async () => {
    try { await saveSnapshot(JSON.stringify(current.current)); onBack(); }
    catch { /* Keep the editor and the user's unsaved values visible. */ }
  };
  const reload = async () => {
    if (dirty && !window.confirm("Reload the saved draft and discard unsaved changes in this window?")) return;
    try {
      await queue.current;
      const value = await request(`/api/dnd/creation/drafts/${initial.id}`);
      revision.current = value.revision; blocked.current = false;
      savedRef.current = JSON.stringify(value.draft);
      setDraft(value.draft); setSaved(savedRef.current); setPreview(value.preview); setError(""); setStatus("Saved");
    } catch (e) { setError(e.message); }
  };
  const roll = async () => {
    setRolling(true);
    try {
      await saveSnapshot(JSON.stringify(current.current));
      const response = await request(`/api/dnd/creation/drafts/${initial.id}/roll`, { method: "POST", body: "{}" });
      setPreview(response.preview);
      if (response.preview.roll_pool) setDraft(old => ({ ...old, scores: Object.fromEntries(ABILITIES.map((ability, i) => [ability, response.preview.roll_pool.totals[i]])) }));
    } catch (e) { setError(e.message); }
    finally { setRolling(false); }
  };
  const changeMethod = method => setDraft(old => ({ ...old, method, scores: Object.fromEntries(ABILITIES.map((ability, i) => [ability, method === "point_buy" ? 8 : method === "rolled" && preview.roll_pool ? preview.roll_pool.totals[i] : ARRAY[i]])) }));
  const assign = (ability, value) => setDraft(old => {
    const scores = { ...old.scores };
    if (["array", "rolled"].includes(old.method)) {
      const other = ABILITIES.find(a => a !== ability && scores[a] === value);
      if (other) scores[other] = scores[ability];
    }
    scores[ability] = value;
    return { ...old, scores };
  });
  const policySave = async () => {
    setPolicyBusy(true);
    try {
      await saveSnapshot(JSON.stringify(current.current));
      const value = await request("/api/dnd/creation/settings", { method: "PUT", body: JSON.stringify(settings) });
      setSettings(null);
      const response = await request(`/api/dnd/creation/drafts/${initial.id}/preview`, { method: "POST", body: JSON.stringify({ draft: current.current }) });
      setPreview({ ...response, policy: value });
    } catch (e) { setError(e.message); }
    finally { setPolicyBusy(false); }
  };
  const finalize = async () => {
    setApprovalBusy(true); setError("");
    try {
      await saveSnapshot(JSON.stringify(current.current));
      if (preview.errors.length) { setStep(preview.errors[0].step); throw new Error("Resolve the listed choices before approval."); }
      if (!window.confirm(`Approve this draft and ${initial.target ? `replace ${initial.target.name}'s current sheet` : "create an unassigned character"}? The current sheet will be saved for recovery.`)) return;
      const value = await request(`/api/dnd/creation/drafts/${initial.id}/finalize`, { method: "POST", body: JSON.stringify({ revision: revision.current, target_revision: initial.target?.revision ?? null, replace_existing: Boolean(initial.target), reviewed: true }) });
      setFinalizedId(value.character_id); await onFinalized?.();
    } catch (e) { setError(e.message); }
    finally { setApprovalBusy(false); }
  };
  const uploadPortrait = async file => {
    if (!file) return;
    setPortraitBusy(true); setError("");
    try {
      const value = await request(`/api/dnd/creation/drafts/${initial.id}/portrait`, { method: "POST", body: file, headers: { "Content-Type": file.type } });
      setPortraitUrl(`${value.portrait_url}?t=${Date.now()}`);
    } catch (e) { setError(e.message); }
    finally { setPortraitBusy(false); }
  };
  const trap = e => {
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); close(); }
    if (e.key === "Tab") {
      const focusable = [...dialog.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')].filter(el => el.offsetParent !== null);
      const first = focusable[0], last = focusable.at(-1);
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  };
  const selectedLabel = key => preview.selected[key] ? `${preview.selected[key].name} · ${preview.selected[key].source}` : "Not selected";
  const skillOptions = preview.class_skill_options;
  const displayedScores = draft.method === "rolled" ? preview.roll_pool?.totals || [] : ARRAY;
  if (finalizedId) return <section className="creation-dialog creation-drafts" role="dialog" aria-modal="true" aria-label="Approved character draft" ref={dialog} tabIndex={-1} onKeyDown={trap}><header className="creation-header"><h2>{draft.name}</h2><button onClick={onBack}>Back to drafts</button></header><main className="creation-main"><p role="status">This draft was approved as character #{finalizedId}. Open the character sheet from the party to use it.</p></main></section>;
  return <section className="creation-dialog" role="dialog" aria-modal="true" aria-label="Character draft builder" ref={dialog} tabIndex={-1} onKeyDown={trap}>
    <header className="creation-header"><div><h2>Build your character</h2><p>Level 1 · Revised 2024 rules · Saved separately from your live sheet</p></div><span role="status">{status}</span><button onClick={reload}>Reload saved draft</button><button onClick={close}>Save & close</button></header>
    {error && <div className="creation-error" role="alert">{error} Your changes remain in this window. Reload to resolve a conflict.</div>}
    <nav className="creation-steps" aria-label="Character creation steps">{STEPS.map(([id, label]) => <button key={id} aria-current={step === id ? "step" : undefined} onClick={() => setStep(id)}>{label}</button>)}</nav>
    <div className="creation-name"><label>Character name<input maxLength={100} value={draft.name} onChange={e => apply("name", e.target.value)} /></label></div>
    <div className="creation-body"><main className="creation-main">
      {step === "class" && <CatalogChoice request={request} draftId={initial.id} version={initial.version} kind="class" label="Class" selected={draft.class_id} onSelect={id => setDraft(old => ({ ...old, class_id: id, class_skills: [], equipment: { ...old.equipment, class: "" } }))} />}
      {step === "origin" && <>
        <CatalogChoice request={request} draftId={initial.id} version={initial.version} kind="race" label="Species" selected={draft.species_id} onSelect={id => setDraft(old => ({ ...old, species_id: id, lineage_id: "" }))} />
        <details><summary>Optional lineage / subrace</summary><p>Select the matching parent species first. Some species describe ancestry choices inside their traits instead.</p><button onClick={() => apply("lineage_id", "")}>Clear lineage</button><CatalogChoice request={request} draftId={initial.id} version={initial.version} kind="subrace" label="Lineage" selected={draft.lineage_id} onSelect={id => apply("lineage_id", id)} /></details>
        <CatalogChoice request={request} draftId={initial.id} version={initial.version} kind="background" label="Background" selected={draft.background_id} onSelect={id => setDraft(old => ({ ...old, background_id: id, boosts: Object.fromEntries(ABILITIES.map(a => [a, 0])), equipment: { ...old.equipment, background: "" } }))} />
      </>}
      {step === "abilities" && <section><h3>Assign ability scores</h3><label>Generation method<select value={draft.method} onChange={e => changeMethod(e.target.value)}>{Object.entries(METHODS).map(([key, label]) => <option key={key} value={key} disabled={!preview.policy.methods.includes(key)}>{label}{!preview.policy.methods.includes(key) ? " — disabled by DM" : ""}</option>)}</select></label>
        {isWarden && <details><summary>Campaign ability methods</summary><p>Recorded rolls are reused across a person's campaign drafts. Manual entry is available only when enabled here.</p>{settings ? <><div className="creation-checks">{Object.entries(METHODS).map(([method, label]) => <label key={method}><input type="checkbox" checked={settings.methods.includes(method)} onChange={e => setSettings(old => ({ ...old, methods: e.target.checked ? [...old.methods, method] : old.methods.filter(m => m !== method) }))} />{label}</label>)}</div><button disabled={policyBusy || !settings.methods.length} onClick={policySave}>Save campaign settings</button><button disabled={policyBusy} onClick={() => setSettings(null)}>Cancel</button></> : <button onClick={() => setSettings({ ...preview.policy })}>Edit allowed methods</button>}</details>}
        {draft.method === "point_buy" && <p>{27 - Object.values(draft.scores).reduce((sum, score) => sum + (COST[score] ?? 0), 0)} of 27 points remaining. Base scores range from 8 to 15.</p>}
        {draft.method === "array" && <p>Assign 15, 14, 13, 12, 10, and 8. Selecting a score swaps its current assignment.</p>}
        {draft.method === "rolled" && <><p>Six rolls of 4d6, dropping the lowest die. Your recorded pool is reused across your campaign drafts.</p><button disabled={rolling} onClick={roll}>{preview.roll_pool ? "Assign recorded scores" : "Roll ability scores"}</button>{preview.roll_pool && <ol className="creation-rolls">{preview.roll_pool.dice.map((dice, i) => <li key={i}>{dice.map((die, j) => j === dice.indexOf(Math.min(...dice)) ? <del key={j}>{die}</del> : <span key={j}>{die}</span>)}<strong>= {preview.roll_pool.totals[i]}</strong></li>)}</ol>}</>}
        <p>Background increases: +2 and +1 to two eligible abilities, or +1 to three. Eligible: {preview.eligible_boosts.map(title).join(", ")}.</p>
        <div className="creation-abilities">{ABILITIES.map(ability => {
          const total = draft.scores[ability] + draft.boosts[ability];
          return <article key={ability}><h4>{title(ability)}</h4><label>Base score{["array", "rolled"].includes(draft.method) ? <select aria-label={`${ability} base score`} value={draft.scores[ability]} onChange={e => assign(ability, Number(e.target.value))}><option value={draft.scores[ability]}>{draft.scores[ability]}</option>{[...new Set(displayedScores)].filter(n => n !== draft.scores[ability]).map(n => <option key={n}>{n}</option>)}</select> : <input aria-label={`${ability} base score`} type="number" min={draft.method === "point_buy" ? 8 : 1} max={draft.method === "point_buy" ? 15 : 20} value={draft.scores[ability]} onChange={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1 && n <= 20) assign(ability, n); }} />}</label><label>Background increase<select aria-label={`${ability} background increase`} value={draft.boosts[ability]} onChange={e => apply("boosts", { ...draft.boosts, [ability]: Number(e.target.value) })}>{[0, 1, 2].map(n => <option key={n} value={n} disabled={n > 0 && !preview.eligible_boosts.includes(ability)}>+{n}</option>)}</select></label><p><strong>{total}</strong> total · {signed(Math.floor((total - 10) / 2))} modifier</p></article>;
        })}</div>
      </section>}
      {step === "training" && <section><h3>Skill proficiencies</h3><p>Choose {preview.class_skill_count} class skills: {draft.class_skills.length} selected.</p><div className="creation-checks">{skillOptions.map(skill => <label key={skill}><input type="checkbox" checked={draft.class_skills.includes(skill)} onChange={e => apply("class_skills", e.target.checked ? [...draft.class_skills, skill] : draft.class_skills.filter(s => s !== skill))} />{title(skill)}{preview.skill_grants[skill]?.some(origin => origin !== "class") && <small>Also granted by {preview.skill_grants[skill].filter(origin => origin !== "class").join(", ")}</small>}</label>)}</div><h4>Granted proficiencies</h4>{Object.entries(preview.skill_grants).map(([skill, sources]) => <p key={skill}>{title(skill)} — {sources.join(", ")}</p>)}{!skillOptions.length && <p>Consult your class details for any choices that need manual review.</p>}</section>}
      {step === "features" && <section><h3>Level-one features and origin choices</h3><p>Features listed by the selected class are granted at level one. Read the class and origin details for decisions within each feature.</p>{preview.level_one_features?.length ? <ul>{preview.level_one_features.map((feature, i) => <li key={i}>{feature.name} · {feature.source}</li>)}</ul> : <p>No level-one feature references found for this class.</p>}<h4>Languages</h4><p>Choose two different standard languages in addition to Common. Selected: {preview.languages?.map(item => item.name).join(", ") || "None"}.</p><CatalogChoice request={request} draftId={initial.id} version={initial.version} kind="language" label="Language catalog" multiple selected={draft.language_ids || []} onSelect={id => apply("language_ids", draft.language_ids?.includes(id) ? draft.language_ids.filter(value => value !== id) : [...(draft.language_ids || []), id])} /><h4>Origin feats</h4><p>Choose {preview.feat_choice_count || 0} additional Origin feats. Granted and selected: {preview.feats?.map(item => item.name).join(", ") || "None"}.</p>{preview.feat_choice_count > 0 && <CatalogChoice request={request} draftId={initial.id} version={initial.version} kind="feat" label="Feat catalog" multiple selected={draft.feat_ids || []} onSelect={id => apply("feat_ids", draft.feat_ids?.includes(id) ? draft.feat_ids.filter(value => value !== id) : [...(draft.feat_ids || []), id])} />}<label>Feature, feat, and language selections<textarea rows={6} maxLength={6000} value={draft.feature_choices || ""} onChange={e => apply("feature_choices", e.target.value)} placeholder="Record your choices and their source, including any feat or language granted by your origin." /></label><p>These selections are retained for DM review. Their rules are not automatically applied to the sheet yet.</p></section>}
      {step === "equipment" && <section><h3>Starting equipment</h3><p>Choose the class and background packages independently. Gold amounts and package items come from the selected source.</p>{["class", "background"].map(source => <fieldset key={source}><legend>{title(source)} equipment</legend>{preview.equipment_options?.[source]?.length ? preview.equipment_options[source].map(option => <label className="creation-package" key={option.id}><input type="radio" name={`${source}-equipment`} checked={draft.equipment?.[source] === option.id} onChange={() => apply("equipment", { ...draft.equipment, [source]: option.id })} /><strong>Option {option.id}</strong><span>{option.label}</span></label>) : <p>Consult the {source} source details to determine starting equipment.</p>}</fieldset>)}</section>}
      {step === "spells" && <section><h3>Spells</h3><p>At level one, this class lists {preview.spell_limits?.cantrips || 0} cantrips and {preview.spell_limits?.level_one || 0} known or prepared spells. Select catalog spells below, then check their class eligibility in the source details.</p><h4>Selected spells</h4>{preview.spells?.length ? <ul>{preview.spells.map(spell => <li key={spell.id}>{spell.name} · {spell.source} · {spell.level === 0 ? "Cantrip" : `Level ${spell.level}`}</li>)}</ul> : <p>None selected.</p>}<label>Additional spell decisions<textarea rows={4} maxLength={6000} value={draft.spell_choices || ""} onChange={e => apply("spell_choices", e.target.value)} placeholder="Record origin-granted spells, preparation choices, and any class spell-list source." /></label><CatalogChoice request={request} draftId={initial.id} version={initial.version} kind="spell" label="Spell catalog" multiple selected={draft.spell_ids || []} onSelect={id => apply("spell_ids", draft.spell_ids?.includes(id) ? draft.spell_ids.filter(value => value !== id) : [...(draft.spell_ids || []), id])} /><p>Class spell eligibility still requires DM review.</p></section>}
      {step === "portrait" && <section><h3>Character portrait</h3><p>Upload a PNG, JPEG, or WebP image up to 3 MB. The portrait is centered and cropped to a square for the character sheet.</p>{portraitUrl && <img className="creation-portrait-preview" src={portraitUrl} alt={`${draft.name || "Character"} portrait preview`} />}<label>Choose portrait image<input type="file" accept="image/png,image/jpeg,image/webp" disabled={portraitBusy} onChange={e => uploadPortrait(e.target.files?.[0])} /></label>{portraitBusy && <p role="status">Uploading portrait…</p>}<p>A portrait is optional; you can complete the draft without one.</p></section>}
      {step === "review" && <section><h3>Review your draft</h3><p>Save your choices, then ask the DM to review source-dependent details and approve the sheet.</p><label>Build notes / choices to review<textarea rows={6} maxLength={6000} value={draft.notes} onChange={e => apply("notes", e.target.value)} placeholder="Record any remaining decisions you want to discuss with your DM." /></label><h4>Needs attention</h4>{preview.errors.map((item, i) => <p key={i}><button onClick={() => setStep(item.step)}>{item.message}</button></p>)}{!preview.errors.length && <p>Required structured choices are complete.</p>}<h4>DM review</h4><ul>{preview.review.map((message, i) => <li key={i}>{message}</li>)}</ul>{finalizedId ? <p role="status">Approved as character #{finalizedId}. The sheet is available in the party.</p> : isWarden ? <button disabled={approvalBusy || preview.errors.length > 0} onClick={finalize}>{approvalBusy ? "Approving…" : initial.target ? `Approve and replace ${initial.target.name}'s sheet` : "Approve and create character"}</button> : <p>When your choices are complete, your DM can approve this draft.</p>}<button onClick={() => saveSnapshot(JSON.stringify(current.current)).catch(() => {})}>Save draft</button></section>}
    </main><details className="creation-summary" aria-label="Saved draft summary" aria-busy={dirty}><summary>Character summary</summary>{dirty && <p>Updating after save…</p>}{["class", "species", "background", ...(draft.lineage_id ? ["lineage"] : [])].map(key => <p key={key}><b>{title(key)}</b><span>{selectedLabel(key)}</span></p>)}<h4>Ability scores</h4>{ABILITIES.map(a => <p key={a}><b>{title(a)}</b><span>{preview.scores[a]} ({signed(preview.modifiers[a])})</span></p>)}<p>{preview.errors.length} foundation choices need attention.</p></details></div>
    <footer className="creation-footer"><button disabled={step === "class"} onClick={() => setStep(STEPS[Math.max(0, STEPS.findIndex(([id]) => id === step) - 1)][0])}>Previous step</button><button disabled={step === "review"} onClick={() => setStep(STEPS[Math.min(STEPS.length - 1, STEPS.findIndex(([id]) => id === step) + 1)][0])}>Next step</button></footer>
  </section>;
}

export default function CharacterBuilder({ request, isWarden, onClose, onFinalized }) {
  const [drafts, setDrafts] = useState([]);
  const [active, setActive] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const createKey = useRef(crypto.randomUUID());
  const launcher = useRef(document.activeElement);
  const panel = useRef(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; panel.current?.focus(); return () => { alive.current = false; launcher.current?.focus?.(); }; }, []);
  useEffect(() => {
    let mounted = true;
    if (!active) request("/api/dnd/creation/drafts").then(value => { if (mounted) setDrafts(value); }).catch(e => { if (mounted) setError(e.message); });
    return () => { mounted = false; };
  }, [request, active]);
  const open = async id => {
    setBusy(true); setError("");
    try {
      const value = id ? await request(`/api/dnd/creation/drafts/${id}`) : await request("/api/dnd/creation/drafts", { method: "POST", body: JSON.stringify({ operation_id: createKey.current }) });
      if (alive.current) { setActive(value); if (!id) createKey.current = crypto.randomUUID(); }
    } catch (e) { if (alive.current) setError(e.message); }
    finally { if (alive.current) setBusy(false); }
  };
  const listKeys = e => {
    e.stopPropagation();
    if (e.key === "Escape" && !busy) onClose();
    if (e.key === "Tab") {
      const nodes = [...panel.current.querySelectorAll("button:not(:disabled)")];
      if (e.shiftKey && (document.activeElement === nodes[0] || document.activeElement === panel.current)) { e.preventDefault(); nodes.at(-1)?.focus(); }
      else if (!e.shiftKey && document.activeElement === nodes.at(-1)) { e.preventDefault(); nodes[0]?.focus(); }
    }
  };
  return <div className="creation-backdrop">{active ? <DraftEditor key={active.id} initial={active} request={request} isWarden={isWarden} onFinalized={onFinalized} onBack={() => { setActive(null); requestAnimationFrame(() => panel.current?.focus()); }} /> : <section className="creation-dialog creation-drafts" role="dialog" aria-modal="true" aria-label="Character creation drafts" ref={panel} tabIndex={-1} onKeyDown={listKeys}><header className="creation-header"><div><h2>Character drafts</h2><p>Start a build or pick up where you left off.</p></div><button disabled={busy} onClick={onClose}>Close</button></header><main className="creation-main">{error && <p role="alert">{error}</p>}<button disabled={busy} onClick={() => open(null)}>{busy ? "Opening…" : "New character draft"}</button><p>Drafts leave your live character unchanged. Your DM can review your saved choices.</p><div className="builder-options">{drafts.map(draft => <article key={draft.id}><div><strong>{draft.name}</strong><small>{draft.is_own ? "Your draft" : "Campaign draft"} · {new Date(draft.updated_at).toLocaleString()}</small></div><button disabled={busy} onClick={() => open(draft.id)}>Resume</button></article>)}</div></main></section>}</div>;
}
