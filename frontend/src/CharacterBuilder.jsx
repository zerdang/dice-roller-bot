import { useEffect, useRef, useState } from "react";
import { abilityIssues, suggestedBoosts, stepBaseScore, stepBoost } from "./builderValidation.js";

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
const clampSplit = value => Math.max(25, Math.min(75, value));

function PaneDivider({ value, onChange, container }) {
  const drag = useRef(null);
  const [dragging, setDragging] = useState(false);
  const finish = () => { drag.current = null; setDragging(false); };
  return <div className={`builder-pane-divider${dragging ? " dragging" : ""}`} role="separator" tabIndex={0} aria-label="Resize options and details panels" aria-orientation="vertical" aria-controls="builder-options builder-details" aria-valuemin={25} aria-valuemax={75} aria-valuenow={Math.round(value)} aria-valuetext={`Options ${Math.round(value)} percent, details ${100 - Math.round(value)} percent`} title="Drag or use Left/Right arrows to resize. Double-click to reset."
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus();
      drag.current = { x: event.clientX, value, width: container.current.clientWidth - 12 };
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => { if (drag.current) onChange(clampSplit(drag.current.value + (event.clientX - drag.current.x) / drag.current.width * 100)); }}
    onPointerUp={event => { finish(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={finish} onLostPointerCapture={finish} onDoubleClick={() => onChange(55)}
    onKeyDown={event => {
      const next = { ArrowLeft: value - (event.shiftKey ? 10 : 2), ArrowRight: value + (event.shiftKey ? 10 : 2), Home: 25, End: 75, Enter: 55 }[event.key];
      if (next !== undefined) { event.preventDefault(); onChange(clampSplit(next)); }
    }}><span aria-hidden="true">⋮</span></div>;
}

function AbilityStepper({ label, value, decrease, increase, canDecrease, canIncrease, fieldProps }) {
  return <div className="builder-ability-stepper" role="group" aria-label={label} tabIndex={-1} {...fieldProps}>
    <button type="button" aria-label={`Decrease ${label}`} disabled={!canDecrease} onClick={decrease}>−</button>
    <output aria-label={`${label} value`}>{value}</output>
    <button type="button" aria-label={`Increase ${label}`} disabled={!canIncrease} onClick={increase}>+</button>
  </div>;
}

function CatalogChoice({ request, draftId, kind, label, selected, onSelect, onInspect, sources = [], multiple = false, contextKey = "", selectionDisabled = false }) {
  const [query, setQuery] = useState("");
  const [edition, setEdition] = useState("");
  const [source, setSource] = useState("");
  const [level, setLevel] = useState("");
  const [school, setSchool] = useState("");
  const [spellList, setSpellList] = useState("");
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const pageSize = 60;
  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      request(`/api/dnd/creation/drafts/${draftId}/options?${new URLSearchParams({ kind, q: query, source, edition, level: kind === "spell" ? level : "", school: kind === "spell" ? school : "", spell_list: kind === "spell" ? spellList : "", offset })}`)
        .then(value => { if (active) { setResult(value); setError(""); } })
        .catch(e => { if (active) setError(e.message); })
        .finally(() => { if (active) setLoading(false); });
    }, 180);
    return () => { active = false; clearTimeout(timer); };
  }, [request, draftId, kind, query, source, edition, level, school, spellList, offset, contextKey]);
  const reset = () => { setQuery(""); setSource(""); setEdition(""); setLevel(""); setSchool(""); setSpellList(""); setOffset(0); };
  return <section className="builder-choice"><div className="builder-choice-heading"><h3>{label}</h3><span>{loading ? "Searching…" : `${result.total.toLocaleString()} matches`}</span></div>
    {kind === "spell" && <label className="builder-spell-list-filter">Spell list<select value={spellList} onChange={e => { setSpellList(e.target.value); setOffset(0); }}><option value="">My class spell list</option><option value="all">All spell lists</option>{result.spell_lists?.map(item => <option key={item.id} value={item.id}>{item.name} · {item.source} · {item.edition}</option>)}</select></label>}
    <div className="builder-filter-bar"><label className="builder-query">Search<input type="search" value={query} onChange={e => { setQuery(e.target.value); setOffset(0); }} placeholder={`Search ${label.toLowerCase()}`} /></label><label>Source<select value={source} onChange={e => { setSource(e.target.value); setOffset(0); }}><option value="">All sources</option>{sources.map(value => <option key={value} value={value}>{value}</option>)}</select></label><label>Edition<select value={edition} onChange={e => { setEdition(e.target.value); setOffset(0); }}><option value="">All editions</option><option value="2024">2024</option><option value="2014">2014</option><option value="unspecified">Unspecified</option></select></label>{kind === "spell" && <><label>Level<select value={level} onChange={e => { setLevel(e.target.value); setOffset(0); }}><option value="">All levels</option><option value="0">Cantrips</option>{Array.from({ length: 9 }, (_, index) => <option key={index + 1} value={index + 1}>Level {index + 1}</option>)}</select></label><label>School<select value={school} onChange={e => { setSchool(e.target.value); setOffset(0); }}><option value="">All schools</option>{Object.entries(SCHOOLS).map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label></>}<button type="button" onClick={reset}>Reset</button></div>
    {error && <p role="alert">{error}</p>}
    <div className="builder-result-list" aria-busy={loading}><table className="builder-result-table" data-column-resize="false"><colgroup>{(kind === "spell" ? [34, 12, 20, 14, 20] : [50, 25, 25]).map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup><thead><tr><th>Option</th>{kind === "spell" && <><th>Level</th><th>School</th></>}<th>Source</th><th>Choice</th></tr></thead><tbody>{result.items.map(item => {
      const picked = multiple ? selected.includes(item.id) : selected === item.id;
      const tooHigh = kind === "spell" && Number(item.metadata?.level) > 1;
      const wrongClass = kind === "spell" && item.eligible_for_character === false;
      const full = kind === "spell" && typeof selectionDisabled === "function" && selectionDisabled(item);
      const reason = tooHigh ? "Only cantrips and level-one spells can be added to a level-one character" : wrongClass ? "This spell is not on your character's class spell list" : full ? "Remove a selected spell of this level before adding another" : "";
      return <tr className={picked ? "selected" : ""} key={item.id}><td><button type="button" className="builder-result-name" onClick={event => onInspect(item, event.currentTarget)} aria-label={`Details for ${item.name} from ${item.source}`}>{item.name}</button>{item.warnings?.length > 0 && <small>Source review needed</small>}</td>{kind === "spell" && <><td data-label="Level">{item.metadata?.level === 0 ? "Cantrip" : item.metadata?.level != null ? `Level ${item.metadata.level}` : "—"}</td><td data-label="School">{item.metadata?.school || "—"}</td></>}<td data-label="Source"><span>{item.source}</span><small>{item.edition === "unspecified" ? "Unspecified" : item.edition}</small></td><td data-label="Choice"><button type="button" className="builder-result-select" aria-pressed={picked} disabled={!picked && Boolean(reason)} onClick={() => onSelect(item.id, item)} title={!picked ? reason || undefined : undefined}>{picked ? multiple ? "Remove" : "Selected" : tooHigh ? "Later" : wrongClass ? "Other class" : full ? "Limit reached" : "Select"}</button></td></tr>;
    })}</tbody></table></div>
    {!loading && !result.total && <p>No matching choices are enabled in this campaign.</p>}
    <nav className="builder-pagination" aria-label={`${label} pages`}><button disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Previous</button><span>{result.total ? `${offset + 1}–${Math.min(offset + pageSize, result.total)} of ${result.total}` : "No results"}</span><button disabled={loading || offset + pageSize >= result.total} onClick={() => setOffset(offset + pageSize)}>Next</button></nav>
  </section>;
}

function LanguageChoices({ request, draftId, selected, savedLanguages, onChange }) {
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const known = useRef(new Map());
  for (const item of [...savedLanguages, ...result.items]) {
    for (const id of item.ids || [item.id]) known.current.set(id, item.name);
  }
  const chosen = new Map();
  for (const id of selected) {
    const name = known.current.get(id) || "Unavailable language";
    const key = known.current.has(id) ? name.toLowerCase() : id;
    if (!chosen.has(key)) chosen.set(key, { name, ids: [] });
    chosen.get(key).ids.push(id);
  }
  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      request(`/api/dnd/creation/drafts/${draftId}/options?${new URLSearchParams({ kind: "language", q: query, offset })}`)
        .then(value => { if (active) { setResult(value); setError(""); } })
        .catch(e => { if (active) setError(e.message); })
        .finally(() => { if (active) setLoading(false); });
    }, 180);
    return () => { active = false; clearTimeout(timer); };
  }, [request, draftId, query, offset]);
  const toggle = item => onChange(current => {
    const aliases = new Set(item.ids || [item.id]);
    const picked = current.some(id => aliases.has(id));
    const remaining = current.filter(id => !aliases.has(id));
    const count = new Set(current.map(id => known.current.get(id)?.toLowerCase() || id)).size;
    return picked ? remaining : count < 2 ? [...remaining, item.id] : current;
  });
  return <section className="builder-languages" aria-label="Languages">
    <h4>Languages</h4><p>Common is already included. Choose two additional languages.</p>
    <p role="status">{chosen.size} / 2 languages selected</p>
    {chosen.size > 0 && <ul className="builder-language-selected">{[...chosen].map(([key, item]) => <li key={key}>{item.name} <button type="button" aria-label={`Remove ${item.name}`} onClick={() => onChange(current => current.filter(id => !item.ids.includes(id)))}>Remove</button></li>)}</ul>}
    <label>Search languages<input type="search" value={query} onChange={event => { setQuery(event.target.value); setOffset(0); }} /></label>
    {error && <p role="alert">{error}</p>}
    <div className="builder-language-list" aria-busy={loading}>{result.items.map(item => {
      const picked = (item.ids || [item.id]).some(id => selected.includes(id));
      return <button type="button" key={item.id} aria-pressed={picked} disabled={!picked && chosen.size >= 2} onClick={() => toggle(item)}>{item.name}{picked && <span aria-hidden="true"> ✓</span>}</button>;
    })}</div>
    {!loading && !result.total && <p>No matching languages.</p>}
    <nav className="builder-pagination" aria-label="Language pages"><button type="button" disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 60))}>Previous</button><span>{loading ? "Loading languages…" : result.total ? `${offset + 1}–${Math.min(offset + 60, result.total)} of ${result.total} unique languages` : "No results"}</span><button type="button" disabled={loading || offset + 60 >= result.total} onClick={() => setOffset(offset + 60)}>Next</button></nav>
  </section>;
}

function DraftEditor({ initial, request, onBack, isWarden, onFinalized }) {
  const [draft, setDraft] = useState(initial.draft);
  const [preview, setPreview] = useState(initial.preview);
  const [saved, setSaved] = useState(JSON.stringify(initial.draft));
  const [status, setStatus] = useState("Saved");
  const [error, setError] = useState("");
  const [step, setStep] = useState("class");
  const [spellPanel, setSpellPanel] = useState("choose");
  const [rolling, setRolling] = useState(false);
  const [settings, setSettings] = useState(null);
  const [policyBusy, setPolicyBusy] = useState(false);
  const [finalizedId, setFinalizedId] = useState(initial.finalized_character_id || null);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [controllerId, setControllerId] = useState(initial.owner_controller_id || "");
  const [portraitUrl, setPortraitUrl] = useState(initial.portrait_url || "");
  const [portraitBusy, setPortraitBusy] = useState(false);
  const [detailPanel, setDetailPanel] = useState(null);
  const [detailExpanded, setDetailExpanded] = useState(false);
  const [paneSplit, setPaneSplit] = useState(() => {
    try { const value = Number.parseFloat(localStorage.getItem("tabletop-builder-split")); return Number.isFinite(value) ? clampSplit(value) : 55; }
    catch { return 55; }
  });
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
  const body = useRef(null);
  const previewBackground = useRef(initial.draft.background_id);
  const spellLevels = useRef(new Map());
  for (const spell of preview.spells || []) spellLevels.current.set(spell.id, spell.level);
  const latest = JSON.stringify(draft);
  current.current = draft;
  const dirty = latest !== saved;
  useEffect(() => { alive.current = true; dialog.current?.focus(); return () => { alive.current = false; }; }, []);
  useEffect(() => { let active = true; request("/api/dnd/reference/meta").then(value => { if (active) setReferenceMeta(value); }).catch(() => {}); return () => { active = false; }; }, [request]);
  useEffect(() => { detailSequence.current++; setDetailPanel(null); setDetailExpanded(false); mainScroll.current?.scrollTo(0, 0); }, [step]);
  useEffect(() => { try { localStorage.setItem("tabletop-builder-split", String(paneSplit)); } catch { /* Browser storage is optional. */ } }, [paneSplit]);
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
          if (JSON.stringify(current.current) === snapshot) { previewBackground.current = JSON.parse(snapshot).background_id; setPreview(response.preview); }
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
      previewBackground.current = value.draft.background_id;
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
  const adjustBase = (ability, delta) => setDraft(old => stepBaseScore(old, preview, ability, delta) || old);
  const adjustBoost = (ability, delta) => setDraft(old => stepBoost(old, preview, ability, delta) || old);
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
      const controller = initial.controllers?.find(item => item.id === controllerId);
      if (isWarden && !controllerId) throw new Error("Choose who will control this character.");
      if (!window.confirm(`${isWarden ? "Approve" : "Submit"} this draft and add ${draft.name || "this character"} under ${controller?.name || "your"} control?`)) return;
      const value = await request(`/api/dnd/creation/drafts/${initial.id}/finalize`, { method: "POST", body: JSON.stringify({ revision: revision.current, controller_id: controllerId, reviewed: true }) });
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
  const pointScoresValid = Object.values(draft.scores).every(score => Number.isInteger(score) && score >= 8 && score <= 15);
  const pointRemaining = pointScoresValid ? 27 - Object.values(draft.scores).reduce((sum, score) => sum + COST[score], 0) : null;
  const cantripCount = (draft.spell_ids || []).filter(id => spellLevels.current.get(id) === 0).length;
  const levelOneCount = (draft.spell_ids || []).filter(id => spellLevels.current.get(id) === 1).length;
  const cantripLimit = preview.spell_limits?.cantrips || 0;
  const levelOneLimit = preview.spell_limits?.level_one || 0;
  const toggleSpell = (id, item) => {
    spellLevels.current.set(id, item.metadata?.level);
    setDraft(old => {
      const chosen = old.spell_ids || [];
      if (chosen.includes(id)) return { ...old, spell_ids: chosen.filter(value => value !== id) };
      const level = item.metadata?.level;
      const count = chosen.filter(value => spellLevels.current.get(value) === level).length;
      const limit = level === 0 ? cantripLimit : level === 1 ? levelOneLimit : 0;
      return count < limit && item.eligible_for_character !== false ? { ...old, spell_ids: [...chosen, id] } : old;
    });
  };
  const contextPending = draft.background_id !== previewBackground.current;
  const boostSpent = Object.values(draft.boosts).reduce((sum, value) => sum + value, 0);
  const liveAbilityIssues = contextPending ? [] : abilityIssues(draft, preview);
  const issues = preview.boost_options?.length ? [...preview.errors.filter(item => !item.fields?.some(field => field.startsWith("boosts."))), ...liveAbilityIssues] : preview.errors;
  const suggestion = !contextPending && liveAbilityIssues.length ? suggestedBoosts(draft, preview) : null;
  const messagesFor = field => issues.filter(item => item.fields?.includes(field)).map(item => item.message);
  const fieldProps = field => ({ id: `builder-${field.replace(".", "-")}`, "aria-invalid": messagesFor(field).length ? true : undefined, "aria-describedby": messagesFor(field).length ? `builder-error-${field.replace(".", "-")}` : undefined });
  const fieldError = field => messagesFor(field).length > 0 && <small className="builder-field-error" id={`builder-error-${field.replace(".", "-")}`}>{messagesFor(field).join(" ")}</small>;
  const goToIssue = issue => { setStep(issue.step); requestAnimationFrame(() => document.getElementById(`builder-${issue.fields?.[0]?.replace(".", "-")}`)?.focus()); };
  const catalogStep = ["class", "origin", "spells"].includes(step);
  if (finalizedId) return <section className="creation-dialog creation-drafts" role="dialog" aria-modal="true" aria-label="Approved character draft" ref={dialog} tabIndex={-1} onKeyDown={trap}><header className="creation-header"><h2>{draft.name}</h2><button onClick={onBack}>Back to drafts</button></header><main className="creation-main"><p role="status">This draft was approved as character #{finalizedId}. Open the character sheet from the party to use it.</p></main></section>;
  return <section className={`creation-dialog${detailPanel ? " detail-open" : ""}`} role="dialog" aria-modal="true" aria-label="Character draft builder" ref={dialog} tabIndex={-1} onKeyDown={trap}>
    <header className="creation-header"><div><h2>Build your character</h2><p>Level 1 · Revised 2024 rules · Saved separately from your live sheet</p></div><span role="status">{status}</span>{!isWarden && !preview.policy.manual_review_required && step === "review" && <button disabled={approvalBusy || dirty || issues.length > 0} onClick={finalize}>{approvalBusy ? "Submitting…" : "Submit character"}</button>}<button className="creation-reload" onClick={reload}>Reload saved draft</button><button onClick={close}>Save & close</button></header>
    {error && <div className="creation-error" role="alert">{error} Your changes remain in this window. Reload to resolve a conflict.</div>}
    <nav className="creation-steps" aria-label="Character creation steps">{STEPS.map(([id, label]) => <button key={id} aria-current={step === id ? "step" : undefined} onClick={() => setStep(id)}>{label}</button>)}</nav>
    <div className="creation-name"><label>Character name<input maxLength={100} value={draft.name} onChange={e => apply("name", e.target.value)} /></label>{isWarden && <label>Controlled by<select value={controllerId} onChange={e => setControllerId(e.target.value)}><option value="">Choose a campaign member</option>{initial.controllers?.map(controller => <option value={controller.id} key={controller.id}>{controller.name}{controller.is_dm ? " (DM)" : ""}</option>)}</select></label>}</div>
    <div className={`creation-body${catalogStep ? " has-catalog" : ""}${detailPanel ? " has-detail" : ""}${detailExpanded ? " expanded" : ""}`} ref={body} style={{ "--builder-list-share": `${paneSplit}fr`, "--builder-detail-share": `${100 - paneSplit}fr` }}><main className="creation-main" id="builder-options" ref={mainScroll}>
      {step === "spells" && <section className="builder-spell-step"><header className="builder-step-heading"><div><h3>Choose spells</h3><p>Choices are limited to spells available to your selected class. Innate spells are tracked separately and do not use these choices.</p></div></header>
        <div className="builder-spell-counts"><div className={cantripCount === cantripLimit ? "complete" : ""}><span>Cantrips</span><strong>{cantripCount} / {cantripLimit}</strong></div><div className={levelOneCount === levelOneLimit ? "complete" : ""}><span>Level-one spells</span><strong>{levelOneCount} / {levelOneLimit}</strong></div></div>
        <nav className="builder-spell-tabs" aria-label="Spell selection views"><button type="button" aria-pressed={spellPanel === "choose"} onClick={() => setSpellPanel("choose")}>Class choices</button><button type="button" aria-pressed={spellPanel === "innate"} onClick={() => setSpellPanel("innate")}>Innate spells ({preview.innate_spells?.length || 0})</button></nav>
        {spellPanel === "innate" ? <div className="builder-innate-spells"><h4>Already granted</h4>{preview.innate_spells?.length ? <ul>{preview.innate_spells.map((spell, index) => <li key={`${spell.name}-${index}`}><strong>{spell.name}</strong> · {title(spell.origin)}{spell.source ? ` · ${spell.source}` : ""}</li>)}</ul> : <p>Your selected species, lineage, and background do not grant any fixed level-one spells.</p>}</div> : !cantripLimit && !levelOneLimit ? <p>This class has no cantrip or level-one spell choices at level one.</p> : <>
          {!preview.spell_eligibility_ready && <p className="builder-spell-next">Class spell-list filtering is temporarily unavailable. Choose from the level-appropriate catalog and have the DM verify the choices against the class source.</p>}
          <CatalogChoice request={request} draftId={initial.id} onInspect={inspect} sources={referenceMeta?.sources || []} kind="spell" label="Spell choices" contextKey={saved} multiple selected={draft.spell_ids || []} onSelect={toggleSpell} selectionDisabled={item => item.metadata?.level === 0 ? cantripCount >= cantripLimit : levelOneCount >= levelOneLimit} />
        </>}
        <h4>Selected spells</h4>{(draft.spell_ids || []).length ? <ul>{draft.spell_ids.map(id => { const spell = preview.spells?.find(value => value.id === id); return <li key={id}>{spell ? `${spell.name} · ${spell.source}` : "Saving selected spell…"} <button type="button" onClick={() => apply("spell_ids", draft.spell_ids.filter(value => value !== id))} aria-label={`Remove ${spell?.name || "selected spell"}`}>Remove</button></li>; })}</ul> : <p>None selected.</p>}
        <label>Additional spell decisions<textarea rows={4} maxLength={6000} value={draft.spell_choices || ""} onChange={e => apply("spell_choices", e.target.value)} placeholder="Record flexible innate spell choices or other source-specific decisions." /></label>
      </section>}
      {step === "class" && <CatalogChoice request={request} draftId={initial.id} onInspect={inspect} sources={referenceMeta?.sources || []} kind="class" label="Class" selected={draft.class_id} onSelect={id => setDraft(old => ({ ...old, class_id: id, class_skills: [], equipment: { ...old.equipment, class: "" } }))} />}
      {step === "origin" && <>
        <CatalogChoice request={request} draftId={initial.id} onInspect={inspect} sources={referenceMeta?.sources || []} kind="race" label="Species" selected={draft.species_id} onSelect={id => setDraft(old => ({ ...old, species_id: id, lineage_id: "" }))} />
        <details><summary>Optional lineage / subrace</summary><p>Select the matching parent species first. Some species describe ancestry choices inside their traits instead.</p><button onClick={() => apply("lineage_id", "")}>Clear lineage</button><CatalogChoice request={request} draftId={initial.id} onInspect={inspect} sources={referenceMeta?.sources || []} kind="subrace" label="Lineage" selected={draft.lineage_id} onSelect={id => apply("lineage_id", id)} /></details>
        <CatalogChoice request={request} draftId={initial.id} onInspect={inspect} sources={referenceMeta?.sources || []} kind="background" label="Background" selected={draft.background_id} onSelect={id => setDraft(old => ({ ...old, background_id: id, boosts: Object.fromEntries(ABILITIES.map(a => [a, 0])), equipment: { ...old.equipment, background: "" } }))} />
      </>}
      {step === "abilities" && <section className="builder-abilities-step"><header className="builder-step-heading"><div><h3>Assign ability scores</h3><p>Set your base scores, then apply the increases from your background.</p></div><label>Generation method<select value={draft.method} onChange={e => changeMethod(e.target.value)}>{Object.entries(METHODS).map(([key, label]) => <option key={key} value={key} disabled={!preview.policy.methods.includes(key)}>{label}{!preview.policy.methods.includes(key) ? " — disabled by DM" : ""}</option>)}</select></label></header>
        {isWarden && <details><summary>Campaign ability methods</summary><p>Recorded rolls are reused across a person's campaign drafts. Manual entry is available only when enabled here.</p>{settings ? <><div className="creation-checks">{Object.entries(METHODS).map(([method, label]) => <label key={method}><input type="checkbox" checked={settings.methods.includes(method)} onChange={e => setSettings(old => ({ ...old, methods: e.target.checked ? [...old.methods, method] : old.methods.filter(m => m !== method) }))} />{label}</label>)}</div><button disabled={policyBusy || !settings.methods.length} onClick={policySave}>Save campaign settings</button><button disabled={policyBusy} onClick={() => setSettings(null)}>Cancel</button></> : <button onClick={() => setSettings({ ...preview.policy })}>Edit allowed methods</button>}</details>}
        {draft.method === "point_buy" && <div className={`builder-point-budget${pointRemaining === null || pointRemaining < 0 ? " invalid" : ""}`} role="status"><strong>{pointRemaining === null ? "Check scores" : `${pointRemaining} / 27 points left`}</strong><span>Each base score must be 8–15. Costs rise as scores increase.</span></div>}
        {draft.method === "array" && <p>Assign 15, 14, 13, 12, 10, and 8. Use + / − to move between these values; the other ability's assignment swaps automatically.</p>}
        {draft.method === "rolled" && <><p>Six rolls of 4d6, dropping the lowest die. Your recorded pool is reused across your campaign drafts.</p><button disabled={rolling} onClick={roll}>{preview.roll_pool ? "Assign recorded scores" : "Roll ability scores"}</button>{preview.roll_pool && <ol className="creation-rolls">{preview.roll_pool.dice.map((dice, i) => <li key={i}>{dice.map((die, j) => j === dice.indexOf(Math.min(...dice)) ? <del key={j}>{die}</del> : <span key={j}>{die}</span>)}<strong>= {preview.roll_pool.totals[i]}</strong></li>)}</ol>}</>}
        <div className="builder-background-boost" role="note"><strong>Ability increases</strong><span>Spend all 3 points. Each click adds +1, with at most +2 per ability. Choose +2/+1 or +1/+1/+1.</span><span>{preview.policy.flexible_background_abilities ? "Unrestricted: all six abilities are available, regardless of species or background." : `Allowed by your background: ${preview.eligible_boosts.map(title).join(", ")}.`}</span></div>
        <div className={`builder-boost-budget${boostSpent > 3 ? " invalid" : boostSpent === 3 ? " complete" : ""}`} role="status" aria-live="polite"><strong>{boostSpent} / 3 ability increases used</strong><span>{boostSpent > 3 ? `Remove ${boostSpent - 3} excess points.` : boostSpent === 3 ? "All 3 points allocated." : `${3 - boostSpent} points remaining. Use + to allocate them.`}</span></div>
        {contextPending ? <p role="status">Updating background choices after save…</p> : issues.some(item => item.step === "abilities") && <div className="builder-validation" aria-live="polite"><strong>Ability choices to fix</strong><ul>{issues.filter(item => item.step === "abilities").map((item, index) => <li key={index}><button type="button" onClick={() => goToIssue(item)}>{item.message}</button></li>)}</ul>{suggestion && <button type="button" onClick={() => apply("boosts", suggestion)}>Use suggested increases: {ABILITIES.filter(a => suggestion[a]).map(a => `${title(a)} +${suggestion[a]}`).join(", ")}</button>}</div>}
        <div className="creation-abilities"><div className="creation-abilities-head" aria-hidden="true"><span>Ability</span><span>Base score</span><span>Ability increase</span><span>Total / modifier</span></div>{ABILITIES.map(ability => {
          const total = draft.scores[ability] + draft.boosts[ability];
          return <article key={ability}><h4>{title(ability)}</h4>
            <div className="builder-ability-control"><span>Base score</span><AbilityStepper label={`${ability} base score`} value={draft.scores[ability]} fieldProps={fieldProps(`scores.${ability}`)} canDecrease={!!stepBaseScore(draft, preview, ability, -1)} canIncrease={!!stepBaseScore(draft, preview, ability, 1)} decrease={() => adjustBase(ability, -1)} increase={() => adjustBase(ability, 1)} />{fieldError(`scores.${ability}`)}</div>
            <div className="builder-ability-control"><span>Ability increase</span><AbilityStepper label={`${ability} ability increase`} value={signed(draft.boosts[ability])} fieldProps={fieldProps(`boosts.${ability}`)} canDecrease={!!stepBoost(draft, preview, ability, -1)} canIncrease={!contextPending && !!stepBoost(draft, preview, ability, 1)} decrease={() => adjustBoost(ability, -1)} increase={() => adjustBoost(ability, 1)} />{fieldError(`boosts.${ability}`)}</div>
            <p className="ability-total"><strong>{total}</strong><span>{signed(Math.floor((total - 10) / 2))} modifier</span></p></article>;
        })}</div>
      </section>}
      {step === "training" && <section><h3>Skill proficiencies</h3><p>Choose {preview.class_skill_count} class skills: {draft.class_skills.length} selected.</p><div className="creation-checks">{skillOptions.map(skill => <label key={skill}><input type="checkbox" checked={draft.class_skills.includes(skill)} onChange={e => apply("class_skills", e.target.checked ? [...draft.class_skills, skill] : draft.class_skills.filter(s => s !== skill))} />{title(skill)}{preview.skill_grants[skill]?.some(origin => origin !== "class") && <small>Also granted by {preview.skill_grants[skill].filter(origin => origin !== "class").join(", ")}</small>}</label>)}</div><h4>Granted proficiencies</h4>{Object.entries(preview.skill_grants).map(([skill, sources]) => <p key={skill}>{title(skill)} — {sources.join(", ")}</p>)}{!skillOptions.length && <p>Consult your class details for any choices that need manual review.</p>}</section>}
      {step === "features" && <section><h3>Level-one features and origin choices</h3><p>Features listed by the selected class are granted at level one. Read the class and origin details for decisions within each feature.</p>{preview.level_one_features?.length ? <ul>{preview.level_one_features.map((feature, i) => <li key={i}>{feature.name} · {feature.source}</li>)}</ul> : <p>No level-one feature references found for this class.</p>}<LanguageChoices request={request} draftId={initial.id} selected={draft.language_ids || []} savedLanguages={preview.languages || []} onChange={update => setDraft(old => ({ ...old, language_ids: update(old.language_ids || []) }))} /><h4>Origin feats</h4><p>Choose {preview.feat_choice_count || 0} additional Origin feats. Granted and selected: {preview.feats?.map(item => item.name).join(", ") || "None"}.</p>{preview.feat_choice_count > 0 && <CatalogChoice request={request} draftId={initial.id} onInspect={inspect} sources={referenceMeta?.sources || []} kind="feat" label="Feat catalog" multiple selected={draft.feat_ids || []} onSelect={id => apply("feat_ids", draft.feat_ids?.includes(id) ? draft.feat_ids.filter(value => value !== id) : [...(draft.feat_ids || []), id])} />}<label>Feature, feat, and language selections<textarea rows={6} maxLength={6000} value={draft.feature_choices || ""} onChange={e => apply("feature_choices", e.target.value)} placeholder="Record your choices and their source, including any feat or language granted by your origin." /></label><p>These selections are retained for DM review. Their rules are not automatically applied to the sheet yet.</p></section>}
      {step === "equipment" && <section><h3>Starting equipment</h3><p>Choose the class and background packages independently. Gold amounts and package items come from the selected source.</p>{["class", "background"].map(source => <fieldset key={source}><legend>{title(source)} equipment</legend>{preview.equipment_options?.[source]?.length ? preview.equipment_options[source].map(option => <label className="creation-package" key={option.id}><input type="radio" name={`${source}-equipment`} checked={draft.equipment?.[source] === option.id} onChange={() => apply("equipment", { ...draft.equipment, [source]: option.id })} /><strong>Option {option.id}</strong><span>{option.label}</span></label>) : <p>Consult the {source} source details to determine starting equipment.</p>}</fieldset>)}</section>}
      {step === "portrait" && <section><h3>Character portrait</h3><p>Upload a PNG, JPEG, or WebP image up to 3 MB. The portrait is centered and cropped to a square for the character sheet.</p>{portraitUrl && <img className="creation-portrait-preview" src={portraitUrl} alt={`${draft.name || "Character"} portrait preview`} />}<label>Choose portrait image<input type="file" accept="image/png,image/jpeg,image/webp" disabled={portraitBusy} onChange={e => uploadPortrait(e.target.files?.[0])} /></label>{portraitBusy && <p role="status">Uploading portrait…</p>}<p>A portrait is optional; you can complete the draft without one.</p></section>}
      {step === "review" && <section className="builder-review-step"><header className="builder-step-heading"><div><h3>Review your draft</h3><p>Check your choices and notes before your DM approves the character.</p></div></header><div className="builder-review-grid"><section className="builder-review-card"><h4>Character foundation</h4><dl>{["class", "species", "background"].map(key => <div key={key}><dt>{title(key)}</dt><dd>{selectedLabel(key)}</dd></div>)}<div><dt>Ability method</dt><dd>{METHODS[draft.method]}</dd></div></dl><h4>Ability scores</h4><div className="builder-review-scores">{ABILITIES.map(ability => { const score = draft.scores[ability] + draft.boosts[ability]; return <div key={ability}><span>{title(ability)}</span><strong>{score}</strong><small>{signed(Math.floor((score - 10) / 2))}</small></div>; })}</div><label>Build notes / choices to review<textarea rows={7} maxLength={6000} value={draft.notes} onChange={e => apply("notes", e.target.value)} placeholder="Record remaining choices or questions for your DM." /></label></section><div className="builder-review-checks"><section className="builder-review-card"><h4>Needs attention</h4>{issues.length ? <ul className="builder-review-issues">{issues.map((item, i) => <li key={i}><button type="button" onClick={() => goToIssue(item)}>{item.message}</button></li>)}</ul> : <p className="builder-review-ready">Required structured choices are complete.</p>}</section><section className="builder-review-card"><h4>DM review</h4>{preview.review.length ? <ul>{preview.review.map((message, i) => <li key={i}>{message}</li>)}</ul> : <p>No additional source checks listed.</p>}{finalizedId ? <p role="status">Approved as character #{finalizedId}. The sheet is available in the party.</p> : isWarden ? <button type="button" disabled={approvalBusy || dirty || issues.length > 0} onClick={finalize}>{approvalBusy ? "Approving…" : initial.target ? `Approve and replace ${initial.target.name}'s sheet` : "Approve and create character"}</button> : <p>When your choices are complete, your DM can approve this draft.</p>}</section><button type="button" onClick={() => saveSnapshot(JSON.stringify(current.current)).catch(() => {})}>Save draft</button></div></div></section>}
    </main><details className="creation-summary" aria-label="Saved draft summary" aria-busy={dirty}><summary>Character summary</summary>{dirty && <p>Updating after save…</p>}{["class", "species", "background", ...(draft.lineage_id ? ["lineage"] : [])].map(key => <p key={key}><b>{title(key)}</b><span>{selectedLabel(key)}</span></p>)}<h4>Ability scores</h4>{ABILITIES.map(a => <p key={a}><b>{title(a)}</b><span>{preview.scores[a]} ({signed(preview.modifiers[a])})</span></p>)}<p>{issues.length} foundation choices need attention.</p></details>{(catalogStep || detailPanel) && !detailExpanded && <PaneDivider value={paneSplit} onChange={setPaneSplit} container={body} />}{catalogStep && !detailPanel && <aside id="builder-details" className="builder-source builder-source-empty" aria-label="Option details"><h3>Explore your options</h3><p>Select a name on the left to read its rules, source, and available metadata here.</p></aside>}{detailPanel && <aside id="builder-details" className="builder-source" aria-label={`${detailPanel.item.name} details`}>
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
  const [deleteId, setDeleteId] = useState("");
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
  const remove = async id => {
    setBusy(true); setError("");
    try {
      await request(`/api/dnd/creation/drafts/${id}`, { method: "DELETE" });
      if (alive.current) { setDrafts(current => current.filter(draft => draft.id !== id)); setDeleteId(""); }
    } catch (e) { if (alive.current) setError(e.message); }
    finally { if (alive.current) setBusy(false); }
  };
  return <div className="creation-backdrop">{active
    ? <DraftEditor key={active.id} initial={active} request={request} isWarden={isWarden} onFinalized={onFinalized} onBack={() => { setActive(null); requestAnimationFrame(() => panel.current?.focus()); }} />
    : <section className="creation-dialog creation-drafts" role="dialog" aria-modal="true" aria-label="Character creation drafts" ref={panel} tabIndex={-1} onKeyDown={listKeys}>
      <header className="creation-header"><div><h2>Character drafts</h2><p>Start a build or pick up where you left off.</p></div><button disabled={busy} onClick={onClose}>Close</button></header>
      <main className="creation-main">
        {error && <p role="alert">{error}</p>}
        <button disabled={busy} onClick={() => open(null)}>{busy ? "Opening…" : "New character draft"}</button>
        <p>Drafts leave your live character unchanged. Your DM can review your saved choices.</p>
        <div className="builder-options draft-summary-list">{drafts.map(draft => <article key={draft.id}>
          <div className="draft-summary-identity">
            <strong>{draft.name}</strong>
            <p className="draft-summary-description">{draft.class_name || "Class not chosen"} · {draft.species_name || "Species not chosen"}</p>
            <small>{draft.is_own ? "Your draft" : "Campaign draft"} · {new Date(draft.updated_at).toLocaleString()}</small>
          </div>
          <dl className="draft-summary-scores" aria-label={`${draft.name} ability scores`}>
            {ABILITIES.map(ability => <div key={ability}><dt title={title(ability)}>{ability.slice(0, 3).toUpperCase()}</dt><dd>{draft.scores?.[ability] ?? "—"}</dd></div>)}
          </dl>
          <div className="draft-summary-actions">
            <button disabled={busy} onClick={() => open(draft.id)}>Resume</button>
            {deleteId === draft.id ? <><button className="delete-record delete-confirm" disabled={busy} onClick={() => remove(draft.id)}>Delete permanently</button><button disabled={busy} onClick={() => setDeleteId("")}>Cancel</button></> : <button className="delete-record" disabled={busy} onClick={() => setDeleteId(draft.id)}>Delete</button>}
          </div>
        </article>)}</div>
      </main>
    </section>}</div>;
}
