import { useEffect, useRef, useState } from "react";

const ABILITIES = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];
const STEPS = [["class", "Class"], ["origin", "Origin"], ["abilities", "Abilities"], ["training", "Skills"], ["features", "Features"], ["equipment", "Equipment"], ["spells", "Spells"], ["portrait", "Portrait"], ["review", "Review"]];
const METHODS = { array: "Standard array", point_buy: "Point buy", rolled: "Recorded rolls", manual: "Manual entry" };
const ARRAY = [15, 14, 13, 12, 10, 8];
const COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
const title = text => text.replace(/\b\w/g, c => c.toUpperCase());
const signed = n => n >= 0 ? `+${n}` : String(n);
const SCHOOLS = { A: "Abjuration", C: "Conjuration", D: "Divination", E: "Enchantment", V: "Evocation", I: "Illusion", N: "Necromancy", T: "Transmutation" };
const META_LABELS = { level: "Level", school: "School", casting_time: "Casting time", range: "Range", components: "Components", duration: "Duration", ritual: "Ritual", classes: "Class lists", hd: "Hit Dice", primaryAbility: "Primary ability", proficiency: "Proficiencies", spellcastingAbility: "Spellcasting ability", size: "Size", speed: "Speed", creatureTypes: "Creature type", ability: "Ability increases", skillProficiencies: "Skills", toolProficiencies: "Tools", languageProficiencies: "Languages", feats: "Feats", prerequisite: "Prerequisites", typicalSpeakers: "Typical speakers", script: "Script" };
const metaValue = (key, value) => key === "level" ? value === 0 ? "Cantrip" : `Level ${value}` : typeof value === "boolean" ? value ? "Yes" : "No" : String(value);

function CatalogChoice({ request, draftId, kind, label, selected, onSelect, onInspect, sources = [], multiple = false }) {
  const [query, setQuery] = useState("");
  const [edition, setEdition] = useState("");
  const [source, setSource] = useState("");
  const [level, setLevel] = useState("");
  const [school, setSchool] = useState("");
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const pageSize = 60;
  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      request(`/api/dnd/creation/drafts/${draftId}/options?${new URLSearchParams({ kind, q: query, source, edition, level: kind === "spell" ? level : "", school: kind === "spell" ? school : "", offset })}`)
        .then(value => { if (active) { setResult(value); setError(""); } })
        .catch(e => { if (active) setError(e.message); })
        .finally(() => { if (active) setLoading(false); });
    }, 180);
    return () => { active = false; clearTimeout(timer); };
  }, [request, draftId, kind, query, source, edition, level, school, offset]);
  const reset = () => { setQuery(""); setSource(""); setEdition(""); setLevel(""); setSchool(""); setOffset(0); };
  return <section className="builder-choice"><div className="builder-choice-heading"><h3>{label}</h3><span>{loading ? "Searching…" : `${result.total.toLocaleString()} matches`}</span></div>
    <div className="builder-filter-bar"><label className="builder-query">Search<input type="search" value={query} onChange={e => { setQuery(e.target.value); setOffset(0); }} placeholder={`Search ${label.toLowerCase()}`} /></label><label>Source<select value={source} onChange={e => { setSource(e.target.value); setOffset(0); }}><option value="">All sources</option>{sources.map(value => <option key={value} value={value}>{value}</option>)}</select></label><label>Edition<select value={edition} onChange={e => { setEdition(e.target.value); setOffset(0); }}><option value="">All editions</option><option value="2024">2024</option><option value="2014">2014</option><option value="unspecified">Unspecified</option></select></label>{kind === "spell" && <><label>Level<select value={level} onChange={e => { setLevel(e.target.value); setOffset(0); }}><option value="">All levels</option><option value="0">Cantrips</option>{Array.from({ length: 9 }, (_, index) => <option key={index + 1} value={index + 1}>Level {index + 1}</option>)}</select></label><label>School<select value={school} onChange={e => { setSchool(e.target.value); setOffset(0); }}><option value="">All schools</option>{Object.entries(SCHOOLS).map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label></>}<button type="button" onClick={reset}>Reset</button></div>
    {error && <p role="alert">{error}</p>}
    <div className="builder-result-list" aria-busy={loading}><table className="builder-result-table"><thead><tr><th>Option</th>{kind === "spell" && <><th>Level</th><th>School</th></>}<th>Source</th><th>Choice</th></tr></thead><tbody>{result.items.map(item => { const picked = multiple ? selected.includes(item.id) : selected === item.id; const tooHigh = kind === "spell" && Number(item.metadata?.level) > 1; return <tr className={picked ? "selected" : ""} key={item.id}><td><button type="button" className="builder-result-name" onClick={event => onInspect(item, event.currentTarget)} aria-label={`Details for ${item.name} from ${item.source}`}>{item.name}</button>{item.warnings?.length > 0 && <small>Source review needed</small>}</td>{kind === "spell" && <><td>{item.metadata?.level === 0 ? "Cantrip" : item.metadata?.level != null ? `Level ${item.metadata.level}` : "—"}</td><td>{item.metadata?.school || "—"}</td></>}<td><span>{item.source}</span><small>{item.edition === "unspecified" ? "Unspecified" : item.edition}</small></td><td><button type="button" className="builder-result-select" aria-pressed={picked} disabled={tooHigh && !picked} onClick={() => onSelect(item.id)} title={tooHigh && !picked ? "Only cantrips and level-one spells can be added to a level-one character" : undefined}>{picked ? multiple ? "Remove" : "Selected" : tooHigh ? "Later" : "Select"}</button></td></tr>; })}</tbody></table></div>
    {!loading && !result.total && <p>No matching choices are enabled in this campaign.</p>}
    <nav className="builder-pagination" aria-label={`${label} pages`}><button disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Previous</button><span>{result.total ? `${offset + 1}–${Math.min(offset + pageSize, result.total)} of ${result.total}` : "No results"}</span><button disabled={loading || offset + pageSize >= result.total} onClick={() => setOffset(offset + pageSize)}>Next</button></nav>
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
  const [detailPanel, setDetailPanel] = useState(null);
  const [detailExpanded, setDetailExpanded] = useState(false);
  const [referenceMeta, setReferenceMeta] = useState(null);
  const revision = useRef(initial.revision);
  const queue = useRef(Promise.resolve());
  const blocked = useRef(false);
  const alive = useRef(true);
  const current = useRef(draft);
  const savedRef = useRef(saved);
  const dialog = useRef(null);
  const detailSequence = useRef(0);
  const detailHeading = useRef(null);
  const detailLauncher = useRef(null);
  const detailScroll = useRef(null);
  const mainScroll = useRef(null);
  const latest = JSON.stringify(draft);
  current.current = draft;
  const dirty = latest !== saved;
  useEffect(() => { alive.current = true; dialog.current?.focus(); return () => { alive.current = false; }; }, []);
  useEffect(() => { let active = true; request("/api/dnd/reference/meta").then(value => { if (active) setReferenceMeta(value); }).catch(() => {}); return () => { active = false; }; }, [request]);
  useEffect(() => { detailSequence.current++; setDetailPanel(null); mainScroll.current?.scrollTo(0, 0); }, [step]);
  useEffect(() => { if (detailPanel && !detailPanel.loading) { detailScroll.current?.scrollTo(0, 0); detailHeading.current?.focus(); } }, [detailPanel]);
  const apply = (key, value) => setDraft(old => ({ ...old, [key]: value }));
  const inspect = async (item, launcher) => {
    const sequence = ++detailSequence.current;
    detailLauncher.current = launcher;
    setDetailExpanded(false);
    setDetailPanel({ item, loading: true, entry: null, error: "" });
    try {
      const entry = await request(`/api/dnd/reference/entries/${item.id}?version=${encodeURIComponent(initial.version)}`);
      if (sequence === detailSequence.current) setDetailPanel({ item, loading: false, entry, error: "" });
    } catch (error) { if (sequence === detailSequence.current) setDetailPanel({ item, loading: false, entry: null, error: error.message }); }
  };
  const closeDetail = () => { detailSequence.current++; setDetailPanel(null); setDetailExpanded(false); requestAnimationFrame(() => detailLauncher.current?.focus()); };
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
    if (e.key === "Escape") { e.preventDefault(); if (detailPanel) closeDetail(); else close(); }
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
  const pointScoresValid = Object.values(draft.scores).every(score => Number.isInteger(score) && score >= 8 && score <= 15);
  const pointRemaining = pointScoresValid ? 27 - Object.values(draft.scores).reduce((sum, score) => sum + COST[score], 0) : null;
  const catalogStep = ["class", "origin", "spells"].includes(step);
  if (finalizedId) return <section className="creation-dialog creation-drafts" role="dialog" aria-modal="true" aria-label="Approved character draft" ref={dialog} tabIndex={-1} onKeyDown={trap}><header className="creation-header"><h2>{draft.name}</h2><button onClick={onBack}>Back to drafts</button></header><main className="creation-main"><p role="status">This draft was approved as character #{finalizedId}. Open the character sheet from the party to use it.</p></main></section>;
  return <section className={`creation-dialog${detailPanel ? " detail-open" : ""}`} role="dialog" aria-modal="true" aria-label="Character draft builder" ref={dialog} tabIndex={-1} onKeyDown={trap}>
    <header className="creation-header"><div><h2>Build your character</h2><p>Level 1 · Revised 2024 rules · Saved separately from your live sheet</p></div><span role="status">{status}</span><button className="creation-reload" onClick={reload}>Reload saved draft</button><button onClick={close}>Save & close</button></header>
    {error && <div className="creation-error" role="alert">{error} Your changes remain in this window. Reload to resolve a conflict.</div>}
    <nav className="creation-steps" aria-label="Character creation steps">{STEPS.map(([id, label]) => <button key={id} aria-current={step === id ? "step" : undefined} onClick={() => setStep(id)}>{label}</button>)}</nav>
    <div className="creation-name"><label>Character name<input maxLength={100} value={draft.name} onChange={e => apply("name", e.target.value)} /></label></div>
    <div className={`creation-body${catalogStep ? " has-catalog" : ""}${detailPanel ? " has-detail" : ""}${detailExpanded ? " expanded" : ""}`}><main className="creation-main" ref={mainScroll}>
      {step === "class" && <CatalogChoice request={request} draftId={initial.id} onInspect={inspect} sources={referenceMeta?.sources || []} kind="class" label="Class" selected={draft.class_id} onSelect={id => setDraft(old => ({ ...old, class_id: id, class_skills: [], equipment: { ...old.equipment, class: "" } }))} />}
      {step === "origin" && <>
        <CatalogChoice request={request} draftId={initial.id} onInspect={inspect} sources={referenceMeta?.sources || []} kind="race" label="Species" selected={draft.species_id} onSelect={id => setDraft(old => ({ ...old, species_id: id, lineage_id: "" }))} />
        <details><summary>Optional lineage / subrace</summary><p>Select the matching parent species first. Some species describe ancestry choices inside their traits instead.</p><button onClick={() => apply("lineage_id", "")}>Clear lineage</button><CatalogChoice request={request} draftId={initial.id} onInspect={inspect} sources={referenceMeta?.sources || []} kind="subrace" label="Lineage" selected={draft.lineage_id} onSelect={id => apply("lineage_id", id)} /></details>
        <CatalogChoice request={request} draftId={initial.id} onInspect={inspect} sources={referenceMeta?.sources || []} kind="background" label="Background" selected={draft.background_id} onSelect={id => setDraft(old => ({ ...old, background_id: id, boosts: Object.fromEntries(ABILITIES.map(a => [a, 0])), equipment: { ...old.equipment, background: "" } }))} />
      </>}
      {step === "abilities" && <section className="builder-abilities-step"><header className="builder-step-heading"><div><h3>Assign ability scores</h3><p>Set your base scores, then apply the increases from your background.</p></div><label>Generation method<select value={draft.method} onChange={e => changeMethod(e.target.value)}>{Object.entries(METHODS).map(([key, label]) => <option key={key} value={key} disabled={!preview.policy.methods.includes(key)}>{label}{!preview.policy.methods.includes(key) ? " — disabled by DM" : ""}</option>)}</select></label></header>
        {isWarden && <details><summary>Campaign ability methods</summary><p>Recorded rolls are reused across a person's campaign drafts. Manual entry is available only when enabled here.</p>{settings ? <><div className="creation-checks">{Object.entries(METHODS).map(([method, label]) => <label key={method}><input type="checkbox" checked={settings.methods.includes(method)} onChange={e => setSettings(old => ({ ...old, methods: e.target.checked ? [...old.methods, method] : old.methods.filter(m => m !== method) }))} />{label}</label>)}</div><button disabled={policyBusy || !settings.methods.length} onClick={policySave}>Save campaign settings</button><button disabled={policyBusy} onClick={() => setSettings(null)}>Cancel</button></> : <button onClick={() => setSettings({ ...preview.policy })}>Edit allowed methods</button>}</details>}
        {draft.method === "point_buy" && <div className={`builder-point-budget${pointRemaining === null || pointRemaining < 0 ? " invalid" : ""}`} role="status"><strong>{pointRemaining === null ? "Check scores" : `${pointRemaining} / 27 points left`}</strong><span>Each base score must be 8–15. Costs rise as scores increase.</span></div>}
        {draft.method === "array" && <p>Assign 15, 14, 13, 12, 10, and 8. Selecting a score swaps its current assignment.</p>}
        {draft.method === "rolled" && <><p>Six rolls of 4d6, dropping the lowest die. Your recorded pool is reused across your campaign drafts.</p><button disabled={rolling} onClick={roll}>{preview.roll_pool ? "Assign recorded scores" : "Roll ability scores"}</button>{preview.roll_pool && <ol className="creation-rolls">{preview.roll_pool.dice.map((dice, i) => <li key={i}>{dice.map((die, j) => j === dice.indexOf(Math.min(...dice)) ? <del key={j}>{die}</del> : <span key={j}>{die}</span>)}<strong>= {preview.roll_pool.totals[i]}</strong></li>)}</ol>}</>}
        <details className="builder-score-help"><summary>Background increases: +2/+1 or +1/+1/+1</summary><p>Apply these to eligible abilities: {preview.eligible_boosts.map(title).join(", ")}.</p></details>
        <div className="creation-abilities"><div className="creation-abilities-head" aria-hidden="true"><span>Ability</span><span>Base score</span><span>Background increase</span><span>Total / modifier</span></div>{ABILITIES.map(ability => {
          const total = draft.scores[ability] + draft.boosts[ability];
          return <article key={ability}><h4>{title(ability)}</h4><label><span>Base score</span>{["array", "rolled"].includes(draft.method) ? <select aria-label={`${ability} base score`} value={draft.scores[ability]} onChange={e => assign(ability, Number(e.target.value))}><option value={draft.scores[ability]}>{draft.scores[ability]}</option>{[...new Set(displayedScores)].filter(n => n !== draft.scores[ability]).map(n => <option key={n}>{n}</option>)}</select> : draft.method === "point_buy" ? <select aria-label={`${ability} base score`} value={draft.scores[ability]} onChange={e => assign(ability, Number(e.target.value))}>{!Number.isInteger(draft.scores[ability]) || draft.scores[ability] < 8 || draft.scores[ability] > 15 ? <option value={draft.scores[ability]}>Invalid: {draft.scores[ability]}</option> : null}{[8, 9, 10, 11, 12, 13, 14, 15].map(score => <option key={score} value={score} disabled={pointRemaining !== null && score !== draft.scores[ability] && COST[score] - (COST[draft.scores[ability]] ?? 0) > pointRemaining}>{score} ({COST[score]} points)</option>)}</select> : <input aria-label={`${ability} base score`} type="number" min="1" max="20" value={draft.scores[ability]} onChange={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1 && n <= 20) assign(ability, n); }} />}</label><label><span>Background increase</span><select aria-label={`${ability} background increase`} value={draft.boosts[ability]} onChange={e => apply("boosts", { ...draft.boosts, [ability]: Number(e.target.value) })}>{[0, 1, 2].map(n => <option key={n} value={n} disabled={n > 0 && !preview.eligible_boosts.includes(ability)}>+{n}</option>)}</select></label><p className="ability-total"><strong>{total}</strong><span>{signed(Math.floor((total - 10) / 2))} modifier</span></p></article>;
        })}</div>
      </section>}
      {step === "training" && <section><h3>Skill proficiencies</h3><p>Choose {preview.class_skill_count} class skills: {draft.class_skills.length} selected.</p><div className="creation-checks">{skillOptions.map(skill => <label key={skill}><input type="checkbox" checked={draft.class_skills.includes(skill)} onChange={e => apply("class_skills", e.target.checked ? [...draft.class_skills, skill] : draft.class_skills.filter(s => s !== skill))} />{title(skill)}{preview.skill_grants[skill]?.some(origin => origin !== "class") && <small>Also granted by {preview.skill_grants[skill].filter(origin => origin !== "class").join(", ")}</small>}</label>)}</div><h4>Granted proficiencies</h4>{Object.entries(preview.skill_grants).map(([skill, sources]) => <p key={skill}>{title(skill)} — {sources.join(", ")}</p>)}{!skillOptions.length && <p>Consult your class details for any choices that need manual review.</p>}</section>}
      {step === "features" && <section><h3>Level-one features and origin choices</h3><p>Features listed by the selected class are granted at level one. Read the class and origin details for decisions within each feature.</p>{preview.level_one_features?.length ? <ul>{preview.level_one_features.map((feature, i) => <li key={i}>{feature.name} · {feature.source}</li>)}</ul> : <p>No level-one feature references found for this class.</p>}<h4>Languages</h4><p>Choose two different standard languages in addition to Common. Selected: {preview.languages?.map(item => item.name).join(", ") || "None"}.</p><CatalogChoice request={request} draftId={initial.id} onInspect={inspect} sources={referenceMeta?.sources || []} kind="language" label="Language catalog" multiple selected={draft.language_ids || []} onSelect={id => apply("language_ids", draft.language_ids?.includes(id) ? draft.language_ids.filter(value => value !== id) : [...(draft.language_ids || []), id])} /><h4>Origin feats</h4><p>Choose {preview.feat_choice_count || 0} additional Origin feats. Granted and selected: {preview.feats?.map(item => item.name).join(", ") || "None"}.</p>{preview.feat_choice_count > 0 && <CatalogChoice request={request} draftId={initial.id} onInspect={inspect} sources={referenceMeta?.sources || []} kind="feat" label="Feat catalog" multiple selected={draft.feat_ids || []} onSelect={id => apply("feat_ids", draft.feat_ids?.includes(id) ? draft.feat_ids.filter(value => value !== id) : [...(draft.feat_ids || []), id])} />}<label>Feature, feat, and language selections<textarea rows={6} maxLength={6000} value={draft.feature_choices || ""} onChange={e => apply("feature_choices", e.target.value)} placeholder="Record your choices and their source, including any feat or language granted by your origin." /></label><p>These selections are retained for DM review. Their rules are not automatically applied to the sheet yet.</p></section>}
      {step === "equipment" && <section><h3>Starting equipment</h3><p>Choose the class and background packages independently. Gold amounts and package items come from the selected source.</p>{["class", "background"].map(source => <fieldset key={source}><legend>{title(source)} equipment</legend>{preview.equipment_options?.[source]?.length ? preview.equipment_options[source].map(option => <label className="creation-package" key={option.id}><input type="radio" name={`${source}-equipment`} checked={draft.equipment?.[source] === option.id} onChange={() => apply("equipment", { ...draft.equipment, [source]: option.id })} /><strong>Option {option.id}</strong><span>{option.label}</span></label>) : <p>Consult the {source} source details to determine starting equipment.</p>}</fieldset>)}</section>}
      {step === "spells" && <section><CatalogChoice request={request} draftId={initial.id} onInspect={inspect} sources={referenceMeta?.sources || []} kind="spell" label="Spell catalog" multiple selected={draft.spell_ids || []} onSelect={id => apply("spell_ids", draft.spell_ids?.includes(id) ? draft.spell_ids.filter(value => value !== id) : [...(draft.spell_ids || []), id])} /><p>At level one, this class lists {preview.spell_limits?.cantrips || 0} cantrips and {preview.spell_limits?.level_one || 0} known or prepared spells. Check class eligibility in the source details.</p><h4>Selected spells</h4>{preview.spells?.length ? <ul>{preview.spells.map(spell => <li key={spell.id}>{spell.name} · {spell.source} · {spell.level === 0 ? "Cantrip" : `Level ${spell.level}`}</li>)}</ul> : <p>None selected.</p>}<label>Additional spell decisions<textarea rows={4} maxLength={6000} value={draft.spell_choices || ""} onChange={e => apply("spell_choices", e.target.value)} placeholder="Record origin-granted spells, preparation choices, and any class spell-list source." /></label><p>Class spell eligibility still requires DM review.</p></section>}
      {step === "portrait" && <section><h3>Character portrait</h3><p>Upload a PNG, JPEG, or WebP image up to 3 MB. The portrait is centered and cropped to a square for the character sheet.</p>{portraitUrl && <img className="creation-portrait-preview" src={portraitUrl} alt={`${draft.name || "Character"} portrait preview`} />}<label>Choose portrait image<input type="file" accept="image/png,image/jpeg,image/webp" disabled={portraitBusy} onChange={e => uploadPortrait(e.target.files?.[0])} /></label>{portraitBusy && <p role="status">Uploading portrait…</p>}<p>A portrait is optional; you can complete the draft without one.</p></section>}
      {step === "review" && <section className="builder-review-step"><header className="builder-step-heading"><div><h3>Review your draft</h3><p>Check your choices and notes before your DM approves the character.</p></div></header><div className="builder-review-grid"><section className="builder-review-card"><h4>Character foundation</h4><dl>{["class", "species", "background"].map(key => <div key={key}><dt>{title(key)}</dt><dd>{selectedLabel(key)}</dd></div>)}<div><dt>Ability method</dt><dd>{METHODS[draft.method]}</dd></div></dl><h4>Ability scores</h4><div className="builder-review-scores">{ABILITIES.map(ability => { const score = draft.scores[ability] + draft.boosts[ability]; return <div key={ability}><span>{title(ability)}</span><strong>{score}</strong><small>{signed(Math.floor((score - 10) / 2))}</small></div>; })}</div><label>Build notes / choices to review<textarea rows={7} maxLength={6000} value={draft.notes} onChange={e => apply("notes", e.target.value)} placeholder="Record remaining choices or questions for your DM." /></label></section><div className="builder-review-checks"><section className="builder-review-card"><h4>Needs attention</h4>{preview.errors.length ? <ul className="builder-review-issues">{preview.errors.map((item, i) => <li key={i}><button type="button" onClick={() => setStep(item.step)}>{item.message}</button></li>)}</ul> : <p className="builder-review-ready">Required structured choices are complete.</p>}</section><section className="builder-review-card"><h4>DM review</h4>{preview.review.length ? <ul>{preview.review.map((message, i) => <li key={i}>{message}</li>)}</ul> : <p>No additional source checks listed.</p>}{finalizedId ? <p role="status">Approved as character #{finalizedId}. The sheet is available in the party.</p> : isWarden ? <button type="button" disabled={approvalBusy || preview.errors.length > 0} onClick={finalize}>{approvalBusy ? "Approving…" : initial.target ? `Approve and replace ${initial.target.name}'s sheet` : "Approve and create character"}</button> : <p>When your choices are complete, your DM can approve this draft.</p>}</section><button type="button" onClick={() => saveSnapshot(JSON.stringify(current.current)).catch(() => {})}>Save draft</button></div></div></section>}
    </main><details className="creation-summary" aria-label="Saved draft summary" aria-busy={dirty}><summary>Character summary</summary>{dirty && <p>Updating after save…</p>}{["class", "species", "background", ...(draft.lineage_id ? ["lineage"] : [])].map(key => <p key={key}><b>{title(key)}</b><span>{selectedLabel(key)}</span></p>)}<h4>Ability scores</h4>{ABILITIES.map(a => <p key={a}><b>{title(a)}</b><span>{preview.scores[a]} ({signed(preview.modifiers[a])})</span></p>)}<p>{preview.errors.length} foundation choices need attention.</p></details>{catalogStep && !detailPanel && <aside className="builder-source builder-source-empty" aria-label="Option details"><h3>Explore your options</h3><p>Select a name on the left to read its rules, source, and available metadata here.</p></aside>}{detailPanel && <aside className="builder-source" aria-label={`${detailPanel.item.name} details`}>
      <header><div><small>Reference details</small><h3 ref={detailHeading} tabIndex={-1}>{detailPanel.item.name}</h3><p>{detailPanel.item.source} · {detailPanel.item.edition === "unspecified" ? "Edition unspecified" : detailPanel.item.edition}{detailPanel.entry?.page || detailPanel.item.page ? ` · p. ${detailPanel.entry?.page || detailPanel.item.page}` : ""}</p></div><div className="builder-source-actions"><button type="button" className="builder-source-expand" onClick={() => setDetailExpanded(value => !value)}>{detailExpanded ? "Show choices" : "Expand"}</button><button type="button" onClick={closeDetail}>Close details</button></div></header>
      <div className="builder-source-scroll" ref={detailScroll} aria-live="polite">{detailPanel.loading ? <p>Loading details…</p> : detailPanel.error ? <p role="alert">{detailPanel.error}</p> : <>{Object.entries(detailPanel.entry.metadata || {}).filter(([, value]) => value !== null && value !== "" && value !== undefined).length > 0 && <dl className="builder-source-meta">{Object.entries(detailPanel.entry.metadata || {}).filter(([, value]) => value !== null && value !== "" && value !== undefined).map(([key, value]) => <div key={key}><dt>{META_LABELS[key] || title(key)}</dt><dd>{metaValue(key, value)}</dd></div>)}</dl>}{detailPanel.entry.warnings?.map((warning, index) => <p className="builder-source-warning" key={index}>{warning}</p>)}<div className="builder-source-text">{detailPanel.entry.text || "Consult the source for this option's complete traits."}</div></>}</div>
    </aside>}</div>
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
