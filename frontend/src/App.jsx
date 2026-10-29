import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { clampStat, normalizeFixedStats } from "./stats.js";
import { itemMetrics, sortInventory, swapInventory } from "./inventory.js";
import { adjustMaxWounds, applyClass, CLASS_DATA } from "./classes.js";
import { catalogByCategory, catalogForSavedItem, catalogItem, equipmentPayload } from "./equipment.js";
import { ALL_SKILLS, canSelectSkill, CLASS_SKILLS, SKILL_BY_ID, SKILL_TIERS } from "./skills.js";
import DndWorkspace from "./DndWorkspace.jsx";
import { GAME_REGISTRY, preferredGame } from "./gameRegistry.js";

const METRIC_PAIRS = [
  ["Strength", "Sanity"], ["Speed", "Fear"], ["Intellect", "Body"], ["Combat", "Armor"],
];

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readCookie(name) {
  const prefix = `${name}=`;
  return document.cookie.split(";").map((value) => value.trim()).find((value) => value.startsWith(prefix))?.slice(prefix.length) || "";
}

function useUtcClock() {
  const [clock, setClock] = useState("00:00:00 UTC");
  useEffect(() => {
    const update = () => setClock(`${new Date().toISOString().slice(11, 19)} UTC`);
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, []);
  return clock;
}

function AccessGate({ message }) {
  return (
    <section className="gate">
      <div className="gate-mark">ACCESS<br />LOCKED</div>
      <p className="eyebrow">AUTHENTICATION REQUIRED</p>
      <h2>Present crew credential</h2>
      <p>{message || <>Use <code>/tabletop link</code> in Discord to get a private player link, or ask your warden for an invite.</>}</p>
    </section>
  );
}

function RollFeed({ rolls }) {
  return (
    <aside>
      <div className="section-heading">
        <p className="index">SEC.02</p>
        <h2>Event telemetry</h2>
        <p>DISCORD RELAY // LIVE POLL</p>
      </div>
      <div className="roll-list">
        {!rolls.length && <p className="empty">Discord rolls will appear here.</p>}
        {rolls.map((roll) => (
          <article className="roll" key={roll.id}>
            <div className="roll-head">
              <strong>{roll.display_name}</strong>
              <time dateTime={roll.created_at}>
                {new Date(roll.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </time>
            </div>
            <p className="expression">{roll.expression}</p>
            <pre>{roll.result}</pre>
          </article>
        ))}
      </div>
    </aside>
  );
}

function TurnOrder({ entries, role, request, refresh, reportError }) {
  const [ordered, setOrdered] = useState(entries || []);
  const [draggedId, setDraggedId] = useState(null);
  const [enemyName, setEnemyName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setOrdered(entries || []), [entries]);

  const write = async (operation) => {
    if (busy || role !== "warden") return;
    setBusy(true);
    try { await operation(); await refresh(true); }
    catch (error) { reportError(error); }
    finally { setBusy(false); }
  };
  const dropOn = (targetId) => {
    if (!draggedId || draggedId === targetId || role !== "warden") return;
    const next = [...ordered];
    const from = next.findIndex((entry) => entry.id === draggedId);
    const to = next.findIndex((entry) => entry.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setOrdered(next);
    setDraggedId(null);
    write(() => request("/api/turn-order", { method: "PATCH", body: JSON.stringify({ entry_ids: next.map((entry) => entry.id) }) }));
  };
  const addEnemy = (event) => {
    event.preventDefault();
    const name = enemyName.trim();
    if (!name) return;
    setEnemyName("");
    write(() => request("/api/turn-order/enemies", { method: "POST", body: JSON.stringify({ name }) }));
  };

  return <aside className="turn-order">
    <div className="section-heading"><p className="index">SEC.03</p><h2>Turn order</h2><p>{role === "warden" ? "DRAG TO REORDER" : "WARDEN CONTROLLED"}</p></div>
    <ol className="turn-list">
      {!ordered.length && <li className="empty">NO CONTACTS TRACKED</li>}
      {ordered.map((entry, index) => <li draggable={role === "warden" && !busy} className={`${entry.kind}${draggedId === entry.id ? " dragging" : ""}`} key={entry.id} onDragStart={() => setDraggedId(entry.id)} onDragEnd={() => setDraggedId(null)} onDragOver={(event) => role === "warden" && event.preventDefault()} onDrop={() => dropOn(entry.id)}>
        <b>{String(index + 1).padStart(2, "0")}</b><span>{entry.name}<small>{entry.kind}</small></span>
        {role === "warden" && entry.kind === "enemy" && <button type="button" disabled={busy} aria-label={`Remove ${entry.name}`} onClick={() => write(() => request(`/api/turn-order/enemies/${entry.id}`, { method: "DELETE" }))}>×</button>}
        {role === "warden" && <i aria-hidden="true">⠿</i>}
      </li>)}
    </ol>
    {role === "warden" && <form className="enemy-add" onSubmit={addEnemy}><input maxLength="100" value={enemyName} onChange={(event) => setEnemyName(event.target.value)} placeholder="ENEMY DESIGNATION" aria-label="Enemy name" /><button disabled={busy || !enemyName.trim()} type="submit">ADD</button></form>}
  </aside>;
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20h4l11-11-4-4L4 16v4Zm12.2-16.2 4 4 1.1-1.1a1.4 1.4 0 0 0 0-2l-2-2a1.4 1.4 0 0 0-2 0l-1.1 1.1Z" />
    </svg>
  );
}

function floatingTip(anchor, content) {
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(340, window.innerWidth - 24);
  const left = rect.right + width + 12 <= window.innerWidth ? rect.right + 8 : Math.max(12, rect.left - width - 8);
  const top = Math.max(12, Math.min(rect.top, window.innerHeight - 230));
  return { ...content, left, top, width };
}

function FloatingDescription({ tip }) {
  if (!tip) return null;
  return createPortal(<div className="floating-description" role="tooltip" style={{ left: tip.left, top: tip.top, width: tip.width }}>
    <strong>{tip.heading}</strong>{tip.meta && <span>{tip.meta}</span>}
    <p>{tip.description}</p>{tip.detail && <em>{tip.detail}</em>}
  </div>, document.body);
}

function StatsPanel({ character, className, saveCharacter, request, refresh, reportError }) {
  const [stats, setStats] = useState(() => normalizeFixedStats(character.stats));
  const [draft, setDraft] = useState(() => normalizeFixedStats(character.stats));
  const [editing, setEditing] = useState(false);
  const [rollingStat, setRollingStat] = useState("");
  const [rollResult, setRollResult] = useState(null);
  const [rollMode, setRollMode] = useState("normal");
  const [rollSkill, setRollSkill] = useState("");

  useEffect(() => {
    if (!editing) {
      setStats(normalizeFixedStats(character.stats));
    }
  }, [character.stats, editing]);

  const beginEdit = () => {
    setDraft({ ...stats });
    setEditing(true);
  };

  const saveEdits = async () => {
    const nextStats = normalizeFixedStats(draft);
    try {
      await saveCharacter(character.id, { stats: nextStats });
      setStats(nextStats);
      setEditing(false);
    } catch (error) {
      reportError(error);
    }
  };

  const rollStat = async (stat) => {
    if (rollingStat) return;
    setRollingStat(stat);
    try {
      const result = await request(`/api/characters/${character.id}/rolls`, {
        method: "POST", body: JSON.stringify({ stat, skill: rollSkill, roll_mode: rollMode }),
      });
      setRollResult(result);
      await refresh(true);
    } catch (error) {
      reportError(error);
    } finally {
      setRollingStat("");
    }
  };

  const metric = (name, isSave = false) => {
    const value = editing ? clampStat(draft[name]) : stats[name];
    const baseSave = isSave ? CLASS_DATA[className]?.saves[name] : null;
    return <div className="metric" key={name}>
      {editing ? <span className="metric-circle editing-circle" style={{ "--value": `${value}%` }}>
        <input type="number" min="0" max="99" value={draft[name]} aria-label={name} onChange={(event) => setDraft((current) => ({ ...current, [name]: event.target.value }))} />
      </span> : <button className={`metric-circle rollable${rollingStat === name ? " rolling" : ""}`} type="button" style={{ "--value": `${value}%` }} disabled={Boolean(rollingStat)} title={`Roll a d100 ${name} check against ${value}`} aria-label={`Roll ${name}, target ${value}`} onClick={() => rollStat(name)}>
        <b>{String(value).padStart(2, "0")}</b>
      </button>}
      <span className="metric-name">{name}</span>
      {baseSave != null && <span className="base-save">BASE {baseSave}</span>}
    </div>;
  };

  return (
    <div className={`stats-panel fixed-stats${editing ? " stats-editing" : ""}`}>
      <div className="stats-toolbar">
        <span className="metric-range">FIXED METRICS // RANGE 00–99</span>
        {editing ? <div className="stats-actions"><button className="quiet" type="button" onClick={() => setEditing(false)}>Cancel</button><button type="button" onClick={saveEdits}>Save</button></div>
          : <button className="edit-stats" type="button" title="Edit metrics" aria-label="Edit metrics" onClick={beginEdit}><EditIcon /><span>Edit</span></button>}
      </div>
      <div className="metric-pair-head"><span>STATS</span><span>SAVES</span></div>
      {!editing && <div className="roll-options">
        <label><span>SKILL BONUS</span><select value={rollSkill} onChange={(event) => setRollSkill(event.target.value)}>
          <option value="">NO APPLICABLE SKILL</option>
          {[...new Set([...(character.skills || []), ...(CLASS_SKILLS[className] || [])])].map((id) => SKILL_BY_ID[id]).filter(Boolean).map((skill) => <option value={skill.id} key={skill.id}>{skill.name} // +{skill.bonus}</option>)}
        </select></label>
        <label><span>ROLL MODE</span><select value={rollMode} onChange={(event) => setRollMode(event.target.value)}>
          <option value="normal">NORMAL</option><option value="advantage">ADVANTAGE [+]</option><option value="disadvantage">DISADVANTAGE [-]</option>
        </select></label>
      </div>}
      <div className="metric-pairs">
        {METRIC_PAIRS.map(([stat, save]) => <div className="metric-pair" key={stat}>{metric(stat)}{metric(save, true)}</div>)}
      </div>
      {rollResult && <div className={`stat-roll-result ${rollResult.success ? "success" : "failure"}${rollResult.critical ? " critical" : ""}`} role="status">
        <span>D100 CHECK // {rollResult.stat.toUpperCase()}</span>
        <strong>{String(rollResult.roll).padStart(2, "0")}</strong>
        <small>TARGET {String(rollResult.target).padStart(2, "0")} // {rollResult.outcome}{rollResult.rolls?.length > 1 ? ` // D100 ${rollResult.rolls.join("/")}` : ""}{rollResult.stress_after > rollResult.stress_before ? ` // STRESS +1` : ""}{rollResult.stat_loss ? ` // MAX STRESS: ${rollResult.stat.toUpperCase()} -1` : ""}{rollResult.panic_roll ? ` // PANIC D20 ${rollResult.panic_roll}: ${rollResult.panic_failed ? "FAILED" : "PASSED"}` : ""}</small>
      </div>}
    </div>
  );
}

const ITEM_KINDS = ["equipment", "weapon", "armor", "consumable", "feature", "item"];

function ItemEditor({ item, onSave, onCancel, onRemove }) {
  const [kind, setKind] = useState(item?.kind || "equipment");
  const submit = (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.equipped = form.elements.equipped.checked;
    onSave(payload);
  };
  return (
    <form className="item-editor" onSubmit={submit}>
      <div className="item-editor-head">
        <span>{item ? "AMEND LOADOUT RECORD" : "REGISTER LOADOUT RECORD"}</span>
        <div><button className="quiet" type="button" onClick={onCancel}>Cancel</button><button type="submit">Save</button></div>
      </div>
      <label className="field-wide"><span>Designation</span><input name="name" required maxLength="100" defaultValue={item?.name || ""} /></label>
      <label><span>Classification</span><select name="kind" value={kind} onChange={(event) => setKind(event.target.value)}>{ITEM_KINDS.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label><span>Quantity</span><input name="quantity" type="number" min="0" defaultValue={item?.quantity ?? 1} /></label>
      {kind === "weapon" && <>
        <label><span>Damage</span><input name="damage" maxLength="100" defaultValue={item?.damage || ""} placeholder="e.g. 3d10 DMG" /></label>
        <label><span>Range</span><input name="range_band" maxLength="100" defaultValue={item?.range_band || ""} placeholder="e.g. 20/100" /></label>
        <label><span>Wound</span><input name="wound" maxLength="100" defaultValue={item?.wound || ""} placeholder="e.g. Gunshot" /></label>
        <label><span>Shots</span><input name="shots" maxLength="100" defaultValue={item?.shots || ""} placeholder="Weapon profile" /></label>
        <label><span>Ammo now</span><input name="ammo" type="number" min="0" defaultValue={item?.ammo ?? ""} /></label>
        <label><span>Ammo max</span><input name="ammo_max" type="number" min="0" defaultValue={item?.ammo_max ?? ""} /></label>
      </>}
      {kind === "armor" && <>
        <label><span>Armor points</span><input name="armor_points" type="number" min="0" defaultValue={item?.armor_points ?? ""} /></label>
        <label><span>Damage reduction</span><input name="damage_reduction" type="number" min="0" defaultValue={item?.damage_reduction ?? ""} /></label>
      </>}
      {(kind === "equipment" || kind === "consumable" || kind === "feature") && <>
        <label><span>Uses now</span><input name="uses" type="number" min="0" defaultValue={item?.uses ?? ""} /></label>
        <label><span>Uses max</span><input name="uses_max" type="number" min="0" defaultValue={item?.uses_max ?? ""} /></label>
      </>}
      <label><span>Cost / credits</span><input name="cost" type="number" min="0" defaultValue={item?.cost ?? ""} /></label>
      <label className="equip-check"><input name="equipped" type="checkbox" defaultChecked={Boolean(item?.equipped)} /><span>Equipped / active</span></label>
      <label className="field-wide"><span>Special / feature</span><textarea name="special" maxLength="1000" defaultValue={item?.special || ""} /></label>
      <label className="field-wide"><span>Notes</span><textarea name="details" maxLength="1000" defaultValue={item?.details || ""} /></label>
      {item && <button className="delete-record" type="button" onClick={onRemove}>Delete record</button>}
    </form>
  );
}

function LegacyInventory({ character, request, refresh, reportError }) {
  const [items, setItems] = useState(character.inventory);
  const [sortMode, setSortMode] = useState("manual");
  const [selectedId, setSelectedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const draggedId = useRef(null);

  useEffect(() => setItems(character.inventory), [character.inventory]);

  const save = async (item, payload) => {
    try {
      await request(item ? `/api/items/${item.id}` : `/api/characters/${character.id}/items`, {
        method: item ? "PATCH" : "POST", body: JSON.stringify(payload),
      });
      setEditingId(null);
      await refresh(true);
    } catch (error) { reportError(error); }
  };

  const remove = async (item) => {
    if (!window.confirm(`Delete ${item.name} from this manifest?`)) return;
    try {
      await request(`/api/items/${item.id}`, { method: "DELETE" });
      setEditingId(null);
      await refresh(true);
    } catch (error) { reportError(error); }
  };

  const quickPatch = async (item, patch) => {
    const before = items;
    setItems((current) => current.map((row) => row.id === item.id ? { ...row, ...patch } : row));
    try { await request(`/api/items/${item.id}`, { method: "PATCH", body: JSON.stringify(patch) }); }
    catch (error) { setItems(before); reportError(error); }
  };

  const swapRows = async (firstId, secondId) => {
    if (!firstId || firstId === secondId) { setSelectedId(firstId === secondId ? null : secondId); return; }
    const before = items;
    const next = swapInventory(items, firstId, secondId);
    setItems(next); setSelectedId(null);
    try {
      await request(`/api/characters/${character.id}/items/order`, { method: "PATCH", body: JSON.stringify({ item_ids: next.map((item) => item.id) }) });
    } catch (error) { setItems(before); reportError(error); }
  };

  const displayed = useMemo(() => sortInventory(items, sortMode), [items, sortMode]);
  const editingItem = editingId === "new" ? null : items.find((item) => item.id === editingId);
  if (editingId) return <ItemEditor item={editingItem} onCancel={() => setEditingId(null)} onSave={(payload) => save(editingItem, payload)} onRemove={() => remove(editingItem)} />;

  return (
    <div className="inventory-panel">
      <div className="inventory-toolbar">
        <div className="sort-control" role="group" aria-label="Sort inventory">
          <span>ORDER</span>
          {["manual", "name", "type", "equipped"].map((mode) => <button type="button" key={mode} className={sortMode === mode ? "active" : ""} aria-pressed={sortMode === mode} onClick={() => { setSortMode(mode); setSelectedId(null); }}>{mode}</button>)}
        </div>
        <button className="add-item" type="button" onClick={() => setEditingId("new")}>+ Register</button>
      </div>
      {!items.length && <button className="inventory-empty" type="button" onClick={() => setEditingId("new")}>NO LOADOUT RECORDS // SELECT TO REGISTER</button>}
      <div className="inventory" aria-label="Loadout manifest">
        {displayed.map((item) => {
          const metrics = itemMetrics(item);
          const counter = item.kind === "weapon" && item.ammo_max != null ? "ammo" : item.uses_max != null ? "uses" : null;
          return (
            <article className={`item-record${selectedId === item.id ? " selected" : ""}`} key={item.id} draggable={sortMode === "manual"}
              onClick={() => sortMode === "manual" && swapRows(selectedId, item.id)}
              onDragStart={() => { draggedId.current = item.id; setSelectedId(item.id); }}
              onDragOver={(event) => sortMode === "manual" && event.preventDefault()}
              onDrop={(event) => { event.preventDefault(); swapRows(draggedId.current, item.id); draggedId.current = null; }}>
              <div className="item-record-head">
                <div><strong>{item.quantity > 1 && `${item.quantity}× `}{item.name}</strong><span className="tag">{item.kind}</span>{Boolean(item.equipped) && <span className="active-tag">ACTIVE</span>}</div>
                <button className="edit-item" type="button" title={`Edit ${item.name}`} aria-label={`Edit ${item.name}`} onClick={(event) => { event.stopPropagation(); setEditingId(item.id); }}><EditIcon /></button>
              </div>
              {!!metrics.length && <div className="item-metrics">{metrics.map(([label, value]) => <span key={label}><small>{label}</small><b>{value}</b></span>)}</div>}
              <p>{item.special || item.details || "NO ADDITIONAL SPECIFICATION"}</p>
              <div className="item-quick" onClick={(event) => event.stopPropagation()}>
                <button type="button" className={item.equipped ? "active" : ""} onClick={() => quickPatch(item, { equipped: !item.equipped })}>{item.equipped ? "Stow" : "Equip"}</button>
                {counter && <>
                  <button type="button" aria-label={`Decrease ${counter}`} onClick={() => quickPatch(item, { [counter]: Math.max(0, Number(item[counter] ?? 0) - 1) })}>−</button>
                  <span>{counter.toUpperCase()} {item[counter] ?? 0}/{item[`${counter}_max`]}</span>
                  <button type="button" aria-label={`Increase ${counter}`} onClick={() => quickPatch(item, { [counter]: Math.min(Number(item[`${counter}_max`]), Number(item[counter] ?? 0) + 1) })}>+</button>
                </>}
              </div>
            </article>
          );
        })}
      </div>
      {sortMode === "manual" && items.length > 1 && <p className="stat-hint">{selectedId ? "RECORD SELECTED // CHOOSE ANOTHER TO SWAP" : "SELECT TWO RECORDS TO SWAP // OR DRAG A RECORD"}</p>}
    </div>
  );
}

function SkillsPanel({ character, saveCharacter, reportError }) {
  const [selected, setSelected] = useState(character.skills || []);
  const [links, setLinks] = useState([]);
  const [descriptionTip, setDescriptionTip] = useState(null);
  const treeRef = useRef(null);
  const nodeRefs = useRef({});
  const classSkills = CLASS_SKILLS[character.class_name] || [];
  const effective = [...new Set([...selected, ...classSkills])];

  useEffect(() => setSelected(character.skills || []), [character.skills]);

  const pruneWithClassSkills = (candidate) => {
    let current = [...new Set(candidate)];
    let next = current.filter((id) => canSelectSkill(SKILL_BY_ID[id], [...current, ...classSkills]));
    while (next.length !== current.length) { current = next; next = current.filter((id) => canSelectSkill(SKILL_BY_ID[id], [...current, ...classSkills])); }
    return next;
  };

  const toggleSkill = async (skill) => {
    if (classSkills.includes(skill.id)) return;
    if (!selected.includes(skill.id) && !canSelectSkill(skill, effective)) return;
    const before = selected;
    const next = selected.includes(skill.id)
      ? pruneWithClassSkills(selected.filter((id) => id !== skill.id))
      : [...selected, skill.id];
    setSelected(next);
    try { await saveCharacter(character.id, { skills: next }); }
    catch (error) { setSelected(before); reportError(error); }
  };

  const measureLinks = useCallback(() => {
    const tree = treeRef.current;
    if (!tree) return;
    const treeBox = tree.getBoundingClientRect();
    const nextLinks = [];
    SKILL_TIERS.slice(1).forEach((tier) => tier.skills.forEach((skill) => {
      const target = nodeRefs.current[skill.id];
      if (!target) return;
      const targetBox = target.getBoundingClientRect();
      skill.requires.forEach((requirement, index) => {
        const source = nodeRefs.current[requirement];
        if (!source) return;
        const sourceBox = source.getBoundingClientRect();
        const x1 = sourceBox.right - treeBox.left;
        const y1 = sourceBox.top + sourceBox.height / 2 - treeBox.top;
        const x2 = targetBox.left - treeBox.left;
        const y2 = targetBox.top + targetBox.height / 2 - treeBox.top;
        const lane = x1 + (x2 - x1) * (.34 + (index % 4) * .1);
        nextLinks.push({
          id: `${requirement}-${skill.id}`,
          path: `M ${x1} ${y1} H ${lane} V ${y2} H ${x2}`,
          x: x2,
          y: y2,
          active: effective.includes(requirement) && effective.includes(skill.id),
        });
      });
    }));
    setLinks(nextLinks);
  }, [character.class_name, selected]);

  useLayoutEffect(() => {
    measureLinks();
    const observer = new ResizeObserver(measureLinks);
    if (treeRef.current) observer.observe(treeRef.current);
    window.addEventListener("resize", measureLinks);
    return () => { observer.disconnect(); window.removeEventListener("resize", measureLinks); };
  }, [measureLinks]);

  return <section className="skills-panel">
    <div className="skill-controls">
      <span>SELECTED {effective.length.toString().padStart(2, "0")} / {ALL_SKILLS.length}</span>
      <b>PREREQUISITE NETWORK</b>
    </div>
    <p className="skill-help">SCROLL VERTICALLY // FOLLOW ORTHOGONAL LINKS // HOVER OR FOCUS FOR DETAILS</p>
    <div className="skill-viewport" onScroll={() => setDescriptionTip(null)}>
      <div className="skill-tree" ref={treeRef}>
        <svg className="skill-links" aria-hidden="true">
          {links.map((link) => <g className={link.active ? "active" : ""} key={link.id}><path d={link.path} /><circle cx={link.x} cy={link.y} r="3" /></g>)}
        </svg>
        {SKILL_TIERS.map((tier) => <section className={`skill-tier ${tier.id}`} key={tier.id}>
          <div className="skill-tier-head"><span>{tier.label}</span><b>+{tier.bonus}</b></div>
          <div className="skill-nodes">
            {tier.skills.map((skill) => {
              const classGranted = classSkills.includes(skill.id);
              const active = effective.includes(skill.id);
              const available = canSelectSkill(skill, effective);
              const prerequisites = skill.requires.map((id) => SKILL_BY_ID[id]?.name).filter(Boolean);
              const showDescription = (element) => setDescriptionTip(floatingTip(element, { heading: `${skill.name} // +${tier.bonus}`, description: skill.description, detail: prerequisites.length > 0 ? `Prerequisite: any of ${prerequisites.join(", ")}` : "No prerequisite." }));
              return <button ref={(node) => { if (node) nodeRefs.current[skill.id] = node; else delete nodeRefs.current[skill.id]; }} type="button" className={`skill-node${active ? " selected" : ""}${classGranted ? " class-granted" : ""}${!available && !active ? " locked" : ""}`} key={skill.id} aria-pressed={active} aria-disabled={!available && !active} onClick={() => toggleSkill(skill)} onMouseEnter={(event) => showDescription(event.currentTarget)} onMouseLeave={() => setDescriptionTip(null)} onFocus={(event) => showDescription(event.currentTarget)} onBlur={() => setDescriptionTip(null)}>
                <span className="skill-node-name">{skill.name}</span><small>{classGranted ? "CLASS" : active ? "TRAINED" : available ? "AVAILABLE" : "LOCKED"}</small>
                {prerequisites.length > 0 && <span className="skill-prereqs"><b>← ANY</b> {prerequisites.join(" / ")}</span>}
              </button>;
            })}
          </div>
        </section>)}
      </div>
    </div>
    <FloatingDescription tip={descriptionTip} />
  </section>;
}

function CrewLogPanel({ character, role, saveCharacter, reportError }) {
  const save = async (field, value) => {
    try { await saveCharacter(character.id, { [field]: value }); }
    catch (error) { reportError(error); }
  };
  return <section className="crew-log-panel">
    <label><span>CREW LOG // SHARED RECORD</span><textarea key={`${character.id}-public-notes`} className="public-notes" defaultValue={character.public_notes || ""} placeholder="ENTER VISIBLE CREW NOTES..." onBlur={(event) => save("public_notes", event.target.value)} /></label>
    {role === "warden" && <label className="warden-only"><span>COMMAND EYES ONLY // RESTRICTED</span><textarea key={`${character.id}-warden-notes`} className="warden-notes classified" defaultValue={character.warden_notes || ""} placeholder="RESTRICTED COMMAND NOTES..." onBlur={(event) => save("warden_notes", event.target.value)} /></label>}
  </section>;
}

const MAP_REGIONS = [
  { id: "garage", label: "Vehicle Bay", points: "150,205 432,205 432,538 366,538 366,485 150,485" },
  { id: "rotunda", label: "Central Rotunda", points: "466,95 864,95 966,155 966,538 687,538 687,469 645,469 645,538 421,538 421,475 470,475" },
  { id: "medbay", label: "Medbay", points: "954,150 1182,150 1182,485 1008,485 1008,580 958,580" },
  { id: "armory", label: "Armory", points: "150,738 381,738 381,965 310,965 310,798 241,914 150,865" },
  { id: "quarters", label: "Cryo Quarters", points: "150,950 489,950 489,1182 150,1182" },
  { id: "laboratory", label: "Laboratory", points: "523,685 809,685 809,1072 523,1072" },
  { id: "east_pod", label: "East Utility Pod", points: "845,630 970,630 970,965 797,965 797,905 850,905" },
];
const MAP_PATHS = [
  { id: "north_vent", label: "North Vent Route", d: "M267 158 L267 52 L1119 52 L1119 151" },
  { id: "east_vent", label: "East Service Route", d: "M1180 349 L1227 349 L1227 614 L943 614" },
];
const MAP_HALLWAYS = [
  { id: "garage-rotunda", rooms: ["garage", "rotunda"], d: "M380 480 L475 480" },
  { id: "rotunda-medbay", rooms: ["rotunda", "medbay"], d: "M850 505 L958 505" },
  { id: "rotunda-laboratory", rooms: ["rotunda", "laboratory"], d: "M666 470 L666 690" },
  { id: "rotunda-armory", rooms: ["rotunda", "armory"], d: "M475 510 L400 510 L400 740" },
  { id: "medbay-east-pod", rooms: ["medbay", "east_pod"], d: "M1008 480 L1008 580 L905 580 L905 635" },
  { id: "armory-quarters", rooms: ["armory", "quarters"], d: "M345 760 L400 760 L400 935 L420 935 L420 960" },
  { id: "armory-laboratory", rooms: ["armory", "laboratory"], d: "M380 935 L525 935" },
  { id: "quarters-laboratory", rooms: ["quarters", "laboratory"], d: "M485 1065 L528 1065" },
  { id: "laboratory-east-pod", rooms: ["laboratory", "east_pod"], d: "M805 900 L850 900" },
];

function Minimap({ role, visibility, onToggle }) {
  const [hoveredRoom, setHoveredRoom] = useState(null);
  const visibleRooms = MAP_REGIONS.filter((region) => visibility?.[region.id]);
  const visiblePaths = MAP_PATHS.filter((path) => visibility?.[path.id]);
  const visibleHallways = MAP_HALLWAYS.filter((hallway) => hallway.rooms.every((room) => visibility?.[room]));
  return <section className="minimap-panel">
    <div className="minimap-frame">
      {role === "warden" ? <>
        <img src="/images/map.png" alt="Complete facility minimap" />
        <svg className="warden-map-hotspots" viewBox="0 0 1300 1333" aria-label="Facility room controls">
          {MAP_REGIONS.map((region) => <polygon points={region.points} className={visibility?.[region.id] ? "revealed" : ""} tabIndex="0" role="button" aria-label={`${region.label}, ${visibility?.[region.id] ? "visible" : "hidden"} to players`} key={region.id} onMouseEnter={() => setHoveredRoom(region)} onMouseLeave={() => setHoveredRoom(null)} onFocus={() => setHoveredRoom(region)} onBlur={() => setHoveredRoom(null)} onClick={() => onToggle(region.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onToggle(region.id); } }}><title>{region.label}</title></polygon>)}
        </svg>
        {hoveredRoom && <div className="map-room-name"><span>ROOM IDENT</span><strong>{hoveredRoom.label}</strong><small>{visibility?.[hoveredRoom.id] ? "VISIBLE TO CREW" : "HIDDEN FROM CREW"}</small></div>}
      </> : <svg className="player-map" viewBox="0 0 1300 1333" role="img" aria-label="Revealed facility minimap regions">
        <defs>
          {visibleRooms.map((region) => <clipPath id={`map-${region.id}`} key={region.id}><polygon points={region.points} /></clipPath>)}
          {visiblePaths.map((path) => <mask id={`map-${path.id}`} maskUnits="userSpaceOnUse" x="0" y="0" width="1300" height="1333" key={path.id}><rect width="1300" height="1333" fill="black" /><path d={path.d} className="path-mask" /></mask>)}
          {visibleHallways.map((hallway) => <mask id={`map-${hallway.id}`} maskUnits="userSpaceOnUse" x="0" y="0" width="1300" height="1333" key={hallway.id}><rect width="1300" height="1333" fill="black" /><path d={hallway.d} className="hallway-mask" /></mask>)}
        </defs>
        <rect className="map-blank" width="1300" height="1333" />
        {visibleRooms.map((region) => <image href="/images/map.png" width="1300" height="1333" preserveAspectRatio="none" clipPath={`url(#map-${region.id})`} key={region.id} />)}
        {visibleHallways.map((hallway) => <image href="/images/map.png" width="1300" height="1333" preserveAspectRatio="none" mask={`url(#map-${hallway.id})`} key={hallway.id} />)}
        {visiblePaths.map((path) => <image href="/images/map.png" width="1300" height="1333" preserveAspectRatio="none" mask={`url(#map-${path.id})`} key={path.id} />)}
        {!visibleRooms.length && !visiblePaths.length && <text className="map-empty-label" x="650" y="666" textAnchor="middle">NO CARTOGRAPHIC DATA</text>}
      </svg>}
    </div>
    {role === "warden" && <div className="map-controls">
      <p>WARDEN REVEAL CONTROLS // CLICK TO TOGGLE PLAYER VISIBILITY</p>
      {[...MAP_REGIONS, ...MAP_PATHS].map((region) => <button type="button" className={visibility?.[region.id] ? "revealed" : "hidden-zone"} aria-pressed={Boolean(visibility?.[region.id])} key={region.id} onClick={() => onToggle(region.id)}><span>{visibility?.[region.id] ? "VISIBLE" : "HIDDEN"}</span>{region.label}</button>)}
    </div>}
  </section>;
}

function LoadoutManifest({ character, role, request, refresh, reportError, saveCharacter, mapVisibility, toggleMapRegion }) {
  const [tab, setTab] = useState("skills");
  return <div className="manifest-tabs">
    <div className="tab-list" role="tablist" aria-label="Character records">
      <button type="button" role="tab" aria-selected={tab === "skills"} className={tab === "skills" ? "active" : ""} onClick={() => setTab("skills")}>Skills</button>
      <button type="button" role="tab" aria-selected={tab === "inventory"} className={tab === "inventory" ? "active" : ""} onClick={() => setTab("inventory")}>Inventory</button>
      <button type="button" role="tab" aria-selected={tab === "log"} className={tab === "log" ? "active" : ""} onClick={() => setTab("log")}>Crew Log</button>
      <button type="button" role="tab" aria-selected={tab === "map"} className={tab === "map" ? "active" : ""} onClick={() => setTab("map")}>Minimap</button>
    </div>
    <div className="tab-panel" role="tabpanel">
      {tab === "skills" ? <SkillsPanel character={character} saveCharacter={saveCharacter} reportError={reportError} /> : tab === "inventory" ? <Inventory character={character} request={request} refresh={refresh} reportError={reportError} /> : tab === "log" ? <CrewLogPanel character={character} role={role} saveCharacter={saveCharacter} reportError={reportError} /> : <Minimap role={role} visibility={mapVisibility} onToggle={toggleMapRegion} />}
    </div>
  </div>;
}

function LoadoutSlot({ type, item, options, busy, onChange, onRollDamage, damageResult }) {
  const savedCatalog = item ? catalogForSavedItem(item) : null;
  const value = savedCatalog?.id || (item ? "__legacy" : "");
  const description = savedCatalog?.description || item?.details || `No ${type} assigned.`;
  const damage = savedCatalog?.damage || item?.damage || "";
  const rollableDamage = /^\d+d10$/i.test(damage);
  return <section className={`loadout-slot ${type}-slot`}>
    <div className="slot-heading"><span>{type.toUpperCase()} SLOT</span><b>{item ? "ONLINE" : "EMPTY"}</b></div>
    <div className="slot-image">
      <img src={`/images/${type}-slot.png`} alt="" />
      <span className="slot-stamp" aria-hidden="true">{type.toUpperCase()} SLOT</span>
    </div>
    <select aria-label={`Equipped ${type}`} value={value} disabled={busy} onChange={(event) => onChange(event.target.value)}>
      <option value="">NO {type.toUpperCase()} ASSIGNED</option>
      {item && !savedCatalog && <option value="__legacy" disabled>{item.name}</option>}
      {options.map((option) => <option value={option.id} key={option.id}>{option.name} // {type === "weapon" ? `DMG ${option.damage}` : `¢${option.cost}`}</option>)}
    </select>
    <div className="slot-readout">
      <strong>{item?.name || "VACANT"}</strong>
      {item && type === "weapon" && <span className="damage-code">DMG {damage || "N/A"}</span>}
      {item && type !== "weapon" && <span>¢{savedCatalog?.cost ?? item.cost ?? 0}</span>}
      <p>{description}</p>
      {type === "weapon" && item && <div className="damage-control">
        <div><small>DAMAGE ARRAY</small><strong>{damage || "N/A"}</strong></div>
        <button type="button" disabled={busy || !rollableDamage} onClick={onRollDamage}>{busy ? "ROLLING..." : rollableDamage ? "ROLL DAMAGE" : "NO DAMAGE ROLL"}</button>
      </div>}
      {type === "weapon" && damageResult && <div className="damage-result" role="status">
        <span>{damageResult.dice.join(" + ")}</span><strong>{damageResult.total}</strong>
      </div>}
    </div>
  </section>;
}

function Inventory({ character, request, refresh, reportError }) {
  const [busy, setBusy] = useState(false);
  const [damageResult, setDamageResult] = useState(null);
  const [descriptionTip, setDescriptionTip] = useState(null);
  const weapon = character.inventory.find((item) => item.kind === "weapon") || null;
  const armor = character.inventory.find((item) => item.kind === "armor") || null;
  const misc = character.inventory.filter((item) => !["weapon", "armor"].includes(item.kind));
  const carriedKeys = new Set(misc.map((item) => catalogForSavedItem(item)?.id).filter(Boolean));

  const write = async (work) => {
    if (busy) return;
    setBusy(true);
    try { await work(); await refresh(true); }
    catch (error) { reportError(error); }
    finally { setBusy(false); }
  };

  const selectSlot = (type, existing, key) => write(async () => {
    if (type === "weapon") setDamageResult(null);
    if (!key) {
      if (existing) await request(`/api/items/${existing.id}`, { method: "DELETE" });
      return;
    }
    const selected = catalogItem(key);
    if (!selected) return;
    const payload = { ...equipmentPayload(selected), equipped: true };
    await request(existing ? `/api/items/${existing.id}` : `/api/characters/${character.id}/items`, {
      method: existing ? "PATCH" : "POST", body: JSON.stringify(payload),
    });
  });

  const addMisc = (key) => write(async () => {
    const selected = catalogItem(key);
    if (!selected || carriedKeys.has(key)) return;
    await request(`/api/characters/${character.id}/items`, {
      method: "POST", body: JSON.stringify(equipmentPayload(selected)),
    });
  });

  const removeMisc = (item) => write(() => request(`/api/items/${item.id}`, { method: "DELETE" }));

  const rollDamage = () => write(async () => {
    if (!weapon) return;
    const result = await request(`/api/characters/${character.id}/damage-rolls`, {
      method: "POST", body: JSON.stringify({ item_id: weapon.id }),
    });
    setDamageResult(result);
  });

  return <div className="loadout-panel">
    <div className="loadout-slots">
      <LoadoutSlot type="weapon" item={weapon} options={catalogByCategory("weapon")} busy={busy} onChange={(key) => selectSlot("weapon", weapon, key)} onRollDamage={rollDamage} damageResult={damageResult} />
      <LoadoutSlot type="armor" item={armor} options={catalogByCategory("armor")} busy={busy} onChange={(key) => selectSlot("armor", armor, key)} />
    </div>
    <section className="misc-equipment">
      <div className="misc-heading"><span>CARRIED EQUIPMENT</span><b>{misc.length.toString().padStart(2, "0")} ITEMS</b></div>
      <select aria-label="Add carried equipment" value="" disabled={busy} onChange={(event) => { addMisc(event.target.value); event.target.value = ""; }}>
        <option value="">+ ADD EQUIPMENT FROM CATALOG</option>
        {catalogByCategory("equipment").map((option) => <option value={option.id} key={option.id} disabled={carriedKeys.has(option.id)}>{option.name}{option.quantity ? ` ×${option.quantity}` : ""} // ¢{option.cost}</option>)}
      </select>
      <div className="misc-list">
        {!misc.length && <p className="empty">NO MISC. EQUIPMENT ON PERSON</p>}
        {misc.map((item) => {
          const catalog = catalogForSavedItem(item);
          const description = catalog?.description || item.details || "No catalog description available.";
          const showDescription = (element) => setDescriptionTip(floatingTip(element, { heading: item.name, meta: `COST ¢${catalog?.cost ?? item.cost ?? 0}`, description }));
          return <div className="misc-record" key={item.id} tabIndex="0" onMouseEnter={(event) => showDescription(event.currentTarget)} onMouseLeave={() => setDescriptionTip(null)} onFocus={(event) => showDescription(event.currentTarget)} onBlur={() => setDescriptionTip(null)}>
            <span><strong>{item.name}</strong>{item.quantity > 1 && <small> ×{item.quantity}</small>}</span>
            <b>¢{catalog?.cost ?? item.cost ?? 0}</b>
            <button type="button" disabled={busy} aria-label={`Remove ${item.name}`} title={`Remove ${item.name}`} onClick={() => removeMisc(item)}>×</button>
          </div>;
        })}
      </div>
      <p className="misc-hint">HOVER OR FOCUS AN ITEM FOR SPECIFICATION</p>
    </section>
    <FloatingDescription tip={descriptionTip} />
  </div>;
}

function ResourceBar({ label, current, max, min, setCurrent, commitCurrent, setMax, commitMax, tone, note }) {
  const numericCurrent = Number(current) || 0;
  const numericMax = Math.max(1, Number(max) || 1);
  const percent = Math.max(0, Math.min(100, (numericCurrent / numericMax) * 100));
  const atLimit = label === "WOUNDS" && numericCurrent >= numericMax;
  return <section className={`resource-bar ${tone}${atLimit ? " at-limit" : ""}`}>
    <div className="resource-label"><span>{label}</span><small>{setMax ? "VARIABLE MAX" : `FIXED MAX ${numericMax}`}</small></div>
    <div className="resource-controls">
      <button type="button" aria-label={`Decrease ${label}`} onClick={() => commitCurrent(numericCurrent - 1)}>−</button>
      <input type="number" min={min} max={numericMax} aria-label={`Current ${label}`} value={current} onChange={(event) => setCurrent(event.target.value)} onBlur={() => commitCurrent(current)} />
      <span>/</span>
      {setMax ? <input type="number" min="1" aria-label={`Maximum ${label}`} value={max} onChange={(event) => setMax(event.target.value)} onBlur={() => commitMax(max)} /> : <b>{numericMax}</b>}
      <button type="button" aria-label={`Increase ${label}`} onClick={() => commitCurrent(numericCurrent + 1)}>+</button>
    </div>
    <div className="resource-track" aria-hidden="true"><i style={{ width: `${percent}%` }} />{min > 0 && <em style={{ left: `${(min / numericMax) * 100}%` }} />}</div>
    <p>{note || (label === "STRESS" ? "BASELINE 02" : "CURRENT / MAXIMUM")}</p>
  </section>;
}

function CharacterCard({ character, role, request, refresh, reportError, mapVisibility, toggleMapRegion }) {
  const [hp, setHp] = useState(character.hp);
  const [maxHp, setMaxHp] = useState(character.max_hp);
  const [wounds, setWounds] = useState(character.wounds ?? 0);
  const [maxWounds, setMaxWounds] = useState(character.max_wounds ?? 2);
  const [stress, setStress] = useState(character.stress ?? 2);
  const [resolve, setResolve] = useState(character.resolve ?? 0);
  const [className, setClassName] = useState(character.class_name || "");
  const [classChanging, setClassChanging] = useState(false);

  useEffect(() => setHp(character.hp), [character.hp]);
  useEffect(() => setMaxHp(character.max_hp), [character.max_hp]);
  useEffect(() => setWounds(character.wounds ?? 0), [character.wounds]);
  useEffect(() => setMaxWounds(character.max_wounds ?? 2), [character.max_wounds]);
  useEffect(() => setStress(character.stress ?? 2), [character.stress]);
  useEffect(() => setResolve(character.resolve ?? 0), [character.resolve]);
  useEffect(() => setClassName(character.class_name || ""), [character.class_name]);

  const saveCharacter = useCallback((id, patch) => request(`/api/characters/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  }), [request]);

  const saveField = async (field, value) => {
    try {
      await saveCharacter(character.id, { [field]: value });
    } catch (error) {
      reportError(error);
    }
  };

  const commitResource = (field, rawValue, minimum, maximum, setter) => {
    const parsed = Number.parseInt(rawValue, 10);
    const normalized = Math.max(minimum, Math.min(maximum, Number.isFinite(parsed) ? parsed : minimum));
    setter(normalized);
    saveField(field, normalized);
  };

  const commitMaxHealth = async (rawValue) => {
    const parsed = Number.parseInt(rawValue, 10);
    const normalizedMax = Math.max(1, Number.isFinite(parsed) ? parsed : 1);
    const normalizedHp = Math.min(normalizedMax, Math.max(0, Number.parseInt(hp, 10) || 0));
    setMaxHp(normalizedMax);
    setHp(normalizedHp);
    try {
      await saveCharacter(character.id, { max_hp: normalizedMax, hp: normalizedHp });
    } catch (error) { reportError(error); }
  };

  const commitMaxWounds = async (rawValue) => {
    const parsed = Number.parseInt(rawValue, 10);
    const normalizedMax = Math.max(1, Math.min(20, Number.isFinite(parsed) ? parsed : 2));
    const normalizedWounds = Math.min(normalizedMax, Math.max(0, Number.parseInt(wounds, 10) || 0));
    setMaxWounds(normalizedMax);
    setWounds(normalizedWounds);
    try {
      await saveCharacter(character.id, { max_wounds: normalizedMax, wounds: normalizedWounds });
    } catch (error) { reportError(error); }
  };

  const changeClass = async (nextClass) => {
    if (!nextClass || nextClass === className || classChanging) return;
    const nextStats = applyClass(character.stats, className, nextClass);
    const nextMaxWounds = adjustMaxWounds(maxWounds, className, nextClass);
    const nextWounds = Math.min(Number(wounds) || 0, nextMaxWounds);
    setClassChanging(true);
    try {
      await saveCharacter(character.id, { class_name: nextClass, stats: nextStats, max_wounds: nextMaxWounds, wounds: nextWounds });
      setClassName(nextClass);
      setMaxWounds(nextMaxWounds);
      setWounds(nextWounds);
      await refresh(true);
    } catch (error) { reportError(error); }
    finally { setClassChanging(false); }
  };

  return (
    <article className="character-card">
      <div className="character-top">
        <div className="name-block">
          <span>CREW RECORD</span>
          <div className="crew-identity-fields">
            <input key={`${character.id}-name`} className="character-name" aria-label="Character name" defaultValue={character.name} onBlur={(event) => saveField("name", event.target.value)} />
            <label className="crew-class"><span>CLASS</span><select aria-label="Character class" value={className} disabled={classChanging} onChange={(event) => changeClass(event.target.value)}>
              <option value="" disabled>SELECT CLASS</option>
              {Object.entries(CLASS_DATA).map(([key, data]) => <option value={key} key={key}>{data.name} // {data.bonusText}</option>)}
            </select></label>
          </div>
        </div>
        <div className="resolve-special">
          <span>SPECIAL // RESOLVE</span>
          <div><button type="button" aria-label="Decrease Resolve" onClick={() => commitResource("resolve", Number(resolve) - 1, 0, 5, setResolve)}>−</button><input type="number" min="0" max="5" value={resolve} aria-label="Resolve" onChange={(event) => setResolve(event.target.value)} onBlur={() => commitResource("resolve", resolve, 0, 5, setResolve)} /><b>/ 5</b><button type="button" aria-label="Increase Resolve" onClick={() => commitResource("resolve", Number(resolve) + 1, 0, 5, setResolve)}>+</button></div>
        </div>
      </div>
      <div className="resource-deck">
        <ResourceBar label="STRESS" tone="stress-resource" current={stress} max={20} min={2} setCurrent={setStress} commitCurrent={(value) => commitResource("stress", value, 2, 20, setStress)} />
        <ResourceBar label="WOUNDS" tone="wounds-resource" current={wounds} max={maxWounds} min={0} setCurrent={setWounds} commitCurrent={(value) => commitResource("wounds", value, 0, Math.max(1, Number(maxWounds) || 2), setWounds)} setMax={setMaxWounds} commitMax={commitMaxWounds} note={Number(wounds) >= Number(maxWounds) ? "MAXIMUM REACHED // MAKE DEATH SAVE" : "CURRENT / MAXIMUM // STARTS AT 2"} />
        <ResourceBar label="HEALTH" tone="health-resource" current={hp} max={maxHp} min={0} setCurrent={setHp} commitCurrent={(value) => commitResource("hp", value, 0, Math.max(1, Number(maxHp) || 1), setHp)} setMax={setMaxHp} commitMax={commitMaxHealth} />
      </div>
      <div className="columns">
        <div>
          <h3><span>01-A</span> Personnel metrics</h3>
          <StatsPanel character={character} className={className} saveCharacter={saveCharacter} request={request} refresh={refresh} reportError={reportError} />
        </div>
        <div>
          <h3><span>02-A</span> Loadout manifest</h3>
          <LoadoutManifest character={character} role={role} request={request} refresh={refresh} reportError={reportError} saveCharacter={saveCharacter} mapVisibility={mapVisibility} toggleMapRegion={toggleMapRegion} />
        </div>
      </div>
    </article>
  );
}

function InfoToken({ label, heading, meta, description, setTip }) {
  const show = (element) => setTip(floatingTip(element, { heading: heading || label, meta, description }));
  return <span className="info-token" tabIndex="0" onMouseEnter={(event) => show(event.currentTarget)} onMouseLeave={() => setTip(null)} onFocus={(event) => show(event.currentTarget)} onBlur={() => setTip(null)}>{label}</span>;
}

function WardenStatsMatrix({ characters }) {
  const [tip, setTip] = useState(null);
  const metrics = METRIC_PAIRS.flatMap(([stat, save]) => [stat, save]);
  return <section className="warden-matrix">
    <div className="matrix-scroll">
      <table>
        <thead><tr><th>CREW MEMBER</th>{metrics.map((metric) => <th key={metric}>{metric}</th>)}<th>SKILLS</th></tr></thead>
        <tbody>{characters.map((character) => {
          const skills = [...new Set([...(character.skills || []), ...(CLASS_SKILLS[character.class_name] || [])])];
          return <tr key={character.id}><th scope="row">{character.name}</th>{metrics.map((metric) => <td className="matrix-value" key={metric}>{String(character.stats?.[metric] ?? 0).padStart(2, "0")}</td>)}<td className="matrix-list">{skills.length ? skills.map((id) => {
            const skill = SKILL_BY_ID[id];
            return skill ? <InfoToken key={id} label={skill.name} heading={`${skill.name} // +${skill.bonus}`} description={skill.description} setTip={setTip} /> : null;
          }) : <span className="matrix-empty">NO SKILLS</span>}</td></tr>;
        })}</tbody>
      </table>
    </div>
    <FloatingDescription tip={tip} />
  </section>;
}

function WardenEquipmentMatrix({ characters }) {
  const [tip, setTip] = useState(null);
  const itemToken = (item) => {
    if (!item) return <span className="matrix-empty">UNASSIGNED</span>;
    const catalog = catalogForSavedItem(item);
    return <InfoToken key={item.id} label={`${item.quantity > 1 ? `${item.quantity}× ` : ""}${item.name}`} meta={catalog?.cost != null ? `COST ¢${catalog.cost}` : ""} description={catalog?.description || item.details || item.special || "No equipment description available."} setTip={setTip} />;
  };
  return <section className="warden-matrix equipment-matrix">
    <div className="matrix-scroll">
      <table>
        <thead><tr><th>CREW MEMBER</th><th>WEAPON</th><th>ARMOR</th><th>OTHER EQUIPMENT</th></tr></thead>
        <tbody>{characters.map((character) => {
          const weapon = character.inventory.find((item) => item.kind === "weapon");
          const armor = character.inventory.find((item) => item.kind === "armor");
          const equipment = character.inventory.filter((item) => !["weapon", "armor"].includes(item.kind));
          return <tr key={character.id}><th scope="row">{character.name}</th><td className="matrix-list">{itemToken(weapon)}</td><td className="matrix-list">{itemToken(armor)}</td><td className="matrix-list">{equipment.length ? equipment.map(itemToken) : <span className="matrix-empty">NONE CARRIED</span>}</td></tr>;
        })}</tbody>
      </table>
    </div>
    <FloatingDescription tip={tip} />
  </section>;
}

function WardenWorkspace({ dashboard, request, refresh, reportError, toggleMapRegion }) {
  const [view, setView] = useState("cards");
  const [characterId, setCharacterId] = useState(dashboard.characters[0]?.id || null);
  useEffect(() => {
    if (!dashboard.characters.some((character) => character.id === characterId)) setCharacterId(dashboard.characters[0]?.id || null);
  }, [dashboard.characters, characterId]);
  const character = dashboard.characters.find((entry) => entry.id === characterId) || dashboard.characters[0];

  return <section className="warden-workspace">
    <div className="section-heading manifest-heading"><div><p className="index">SEC.01</p><h2>Crew oversight</h2></div><p>WARDEN // CONSOLIDATED RECORDS</p></div>
    <div className="warden-view-tabs" role="tablist" aria-label="Warden crew views">
      {[['cards', 'Crew Cards'], ['stats', 'Stats + Skills'], ['equipment', 'Equipment']].map(([id, label]) => <button type="button" role="tab" aria-selected={view === id} className={view === id ? "active" : ""} key={id} onClick={() => setView(id)}>{label}</button>)}
    </div>
    {view === "cards" && <>
      <div className="crew-card-tabs" role="tablist" aria-label="Crew member cards">{dashboard.characters.map((entry) => <button type="button" role="tab" aria-selected={character?.id === entry.id} className={character?.id === entry.id ? "active" : ""} key={entry.id} onClick={() => setCharacterId(entry.id)}>{entry.name}</button>)}</div>
      {character ? <CharacterCard character={character} role="warden" request={request} refresh={refresh} reportError={reportError} mapVisibility={dashboard.map_visibility} toggleMapRegion={toggleMapRegion} /> : <p className="empty">NO CREW RECORDS</p>}
    </>}
    {view === "stats" && <WardenStatsMatrix characters={dashboard.characters} />}
    {view === "equipment" && <WardenEquipmentMatrix characters={dashboard.characters} />}
  </section>;
}

function Workspace({ onLogout }) {
  const clock = useUtcClock();
  const [dashboard, setDashboard] = useState(null);
  const [selectedGame, setSelectedGame] = useState(preferredGame);
  const explicitGameApplied = useRef(false);
  const [phase, setPhase] = useState("loading");
  const [message, setMessage] = useState("");
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("tabletop-theme");
    return ["crt", "simple", "fantasy"].includes(saved) ? saved : "crt";
  });
  const [crtStrength, setCrtStrength] = useState(() => {
    const saved = Number.parseInt(localStorage.getItem("tabletop-crt-strength"), 10);
    return Number.isFinite(saved) ? Math.max(0, Math.min(100, saved)) : 34;
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("tabletop-theme", theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty("--crt-strength", String(crtStrength / 100));
    localStorage.setItem("tabletop-crt-strength", String(crtStrength));
  }, [crtStrength]);

  const request = useCallback(async (path, options = {}) => {
    const { raw = false, ...fetchOptions } = options;
    const method = (options.method || "GET").toUpperCase();
    const response = await fetch(path, {
      ...fetchOptions,
      credentials: "same-origin",
      headers: {
        ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
        ...(!["GET", "HEAD", "OPTIONS"].includes(method) ? { "X-CSRF-Token": decodeURIComponent(readCookie("dm_csrf")) } : {}),
        ...(options.headers || {}),
      },
    });
    if (!response.ok) throw new ApiError(response.status, await response.text());
    if (raw) return response;
    return response.status === 204 ? null : response.json();
  }, []);

  const refresh = useCallback(async (force = false) => {
    try {
      const data = await request("/api/dashboard");
      const formFieldActive = document.activeElement?.matches("input, textarea, select");
      if (force || !formFieldActive) setDashboard(data);
      if (!explicitGameApplied.current) {
        setSelectedGame(data.campaign.game_system);
        explicitGameApplied.current = true;
      }
      setPhase("ready");
      setMessage("");
    } catch (error) {
      if (error.status === 401) {
        setDashboard(null);
        onLogout();
      } else {
        setMessage("Relay interrupted. Retrying connection…");
        setPhase((current) => current === "ready" ? current : "offline");
      }
    }
  }, [request, onLogout]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 2500);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const clearCredential = async () => {
    try { await request("/api/auth/logout", { method: "POST" }); } finally { onLogout(); }
  };

  const reportError = (error) => setMessage(error?.message || "Terminal write failed.");
  const toggleMapRegion = async (regionId) => {
    if (dashboard?.role !== "warden") return;
    const next = { ...(dashboard.map_visibility || {}), [regionId]: !dashboard.map_visibility?.[regionId] };
    setDashboard((current) => ({ ...current, map_visibility: next }));
    try {
      await request("/api/map-visibility", { method: "PATCH", body: JSON.stringify(next) });
    } catch (error) {
      reportError(error);
      await refresh(true);
    }
  };
  const roleLabel = dashboard ? `${dashboard.role} view` : phase === "loading" ? "Establishing uplink" : "Link offline";
  const selectGame = (game) => {
    setSelectedGame(game);
    localStorage.setItem("tabletop-game", game);
  };

  return (
    <>
      <div className="crt-overlay" aria-hidden="true" />
      <div className={`shell${dashboard?.role ? ` ${dashboard.role}-shell` : ""}`}>
        <div className="system-bar">
          <span>{dashboard ? `${dashboard.campaign.name} // ${dashboard.campaign.game_system.toUpperCase()} // ${roleLabel}` : "TABLETOP // LOCAL RELAY"}</span>
          <span>{clock}</span>
          <span className="system-link">LINK: <b>{phase === "ready" ? "ENCRYPTED" : "PENDING"}</b><label className="game-picker"><span>GAME</span><select value={selectedGame} aria-label="Game" onChange={(event) => selectGame(event.target.value)}>{GAME_REGISTRY.map((game) => <option value={game.id} key={game.id}>{game.label}</option>)}</select></label>{theme === "crt" && <label className="crt-strength"><span>CRT</span><input type="range" min="0" max="100" value={crtStrength} aria-label="CRT effect strength" onChange={(event) => setCrtStrength(Number(event.target.value))} /><b>{crtStrength}%</b></label>}<label className="theme-picker"><span>DISPLAY</span><select value={theme} aria-label="Display theme" onChange={(event) => setTheme(event.target.value)}><option value="crt">CRT</option><option value="simple">SIMPLE</option><option value="fantasy">FANTASY</option></select></label><button className="credential-clear" type="button" onClick={clearCredential}>Sign out</button></span>
        </div>

        {message && phase === "ready" && <div className="flash" role="status">SYS/WARN // {message}</div>}

        {phase === "ready" && dashboard && selectedGame !== dashboard.campaign.game_system ? (
          <section className="game-empty"><p className="index">GAME CONTEXT // {selectedGame.toUpperCase()}</p><h2>No authorized {GAME_REGISTRY.find((game) => game.id === selectedGame)?.label} campaign on this link</h2><p>Changing this selector only changes your view. It cannot convert this campaign or grant access to another one.</p><button type="button" onClick={() => selectGame(dashboard.campaign.game_system)}>Return to {dashboard.campaign.game_system === "dnd" ? "D&D" : "Mothership"}</button></section>
        ) : phase === "ready" && dashboard?.campaign.game_system === "dnd" ? (
          <DndWorkspace dashboard={dashboard} request={request} refresh={refresh} reportError={reportError} />
        ) : phase === "ready" && dashboard ? (
          <main>
            <section className="characters">
              {dashboard.role === "warden" ? <WardenWorkspace dashboard={dashboard} request={request} refresh={refresh} reportError={reportError} toggleMapRegion={toggleMapRegion} /> : <>
                <div className="section-heading manifest-heading"><div><p className="index">SEC.01</p><h2>Personnel file</h2></div><p>AUTO-WRITE // FIELD EXIT</p></div>
                <div>{dashboard.characters.map((character) => <CharacterCard key={character.id} character={character} role="player" request={request} refresh={refresh} reportError={reportError} mapVisibility={dashboard.map_visibility} />)}</div>
              </>}
            </section>
            <RollFeed rolls={dashboard.rolls} />
            <TurnOrder entries={dashboard.turn_order} role={dashboard.role} request={request} refresh={refresh} reportError={reportError} />
          </main>
        ) : phase === "loading" ? (
          <section className="boot" aria-live="polite"><span>BOOT/77</span><p>Negotiating secure relay...</p><div /></section>
        ) : (
          <AccessGate message={message} />
        )}
      </div>
    </>
  );
}

async function sessionRequest(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(!["GET", "HEAD", "OPTIONS"].includes(method) ? { "X-CSRF-Token": decodeURIComponent(readCookie("dm_csrf")) } : {}),
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new ApiError(response.status, await response.text());
  return response.status === 204 ? null : response.json();
}

function Landing({ error, invite }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(error || "");
  const begin = async () => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/auth/begin", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invite: invite || null }),
      });
      if (!response.ok) throw new Error(await response.text());
      window.location.assign((await response.json()).authorize_url);
    } catch (failure) { setMessage(failure.message || "Sign-in could not be started."); setBusy(false); }
  };
  return <main className="login-page">
    <section className="login-card">
      <div className="login-mark" aria-hidden="true">D20</div>
      <p className="eyebrow">YOUR TABLE, ONE SCREEN</p>
      <h1>DM Screen</h1>
      <p className="login-copy">Campaign tools, character sheets, and a shared battlemap for your group.</p>
      {invite && <p className="invite-notice">You have been invited to join a campaign. Sign in to accept.</p>}
      {message && <p className="login-error" role="alert">{message}</p>}
      <button className="discord-login" type="button" disabled={busy} onClick={begin}>
        <span aria-hidden="true">◉</span>{busy ? "Connecting…" : "Continue with Discord"}
      </button>
      <small>We request only your basic Discord identity.</small>
    </section>
  </main>;
}

function CampaignHome({ account, reload, signOut, initialMessage = "" }) {
  const [name, setName] = useState("");
  const [game, setGame] = useState("dnd");
  const [message, setMessage] = useState(initialMessage);
  const [inviteUrl, setInviteUrl] = useState("");
  const [invites, setInvites] = useState([]);
  const [open, setOpen] = useState(false);
  const active = account.campaigns.find((campaign) => campaign.id === account.active_campaign_id);
  const select = async (campaignId) => {
    await sessionRequest("/api/campaigns/select", { method: "POST", body: JSON.stringify({ campaign_id: Number(campaignId) }) });
    await reload();
  };
  const create = async (event) => {
    event.preventDefault(); setMessage("");
    try {
      await sessionRequest("/api/campaigns", { method: "POST", body: JSON.stringify({ name, game_system: game }) });
      setName(""); setOpen(false); await reload();
    } catch (failure) { setMessage(failure.message); }
  };
  const invite = async () => {
    try {
      const result = await sessionRequest("/api/invitations", { method: "POST", body: "{}" });
      setInviteUrl(result.url); setOpen(true); setMessage("");
      setInvites(await sessionRequest("/api/invitations"));
    } catch (failure) { setMessage(failure.message); }
  };
  const revoke = async (tokenHash) => {
    try {
      await sessionRequest(`/api/invitations/${tokenHash}`, { method: "DELETE", body: "{}" });
      setInvites(await sessionRequest("/api/invitations"));
    } catch (failure) { setMessage(failure.message); }
  };
  const logout = async () => { try { await sessionRequest("/api/auth/logout", { method: "POST", body: "{}" }); } finally { signOut(); } };

  return <>
    <nav className="account-bar" aria-label="Account and campaign">
      <a href="/" className="account-brand">DM Screen</a>
      <div className="account-actions">
        {account.campaigns.length > 0 && <label><span>Campaign</span><select value={account.active_campaign_id || ""} onChange={(event) => select(event.target.value)}>{!account.active_campaign_id && <option value="">Select campaign</option>}{account.campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name} · {campaign.role === "warden" ? "DM" : "Player"}</option>)}</select></label>}
        {active?.role === "warden" && <button type="button" onClick={invite}>Invite player</button>}
        <button type="button" onClick={() => { setInviteUrl(""); setOpen((value) => !value); }}>New campaign</button>
        <span>{account.user.global_name || account.user.username}</span>
        <button className="quiet" type="button" onClick={logout}>Sign out</button>
      </div>
    </nav>
    {open && <section className="campaign-panel">
      {inviteUrl ? <><p className="eyebrow">SINGLE-USE PLAYER INVITATION</p><h2>Invitation ready</h2><p>This link expires in seven days and grants player access only.</p><div className="invite-copy"><input readOnly value={inviteUrl} aria-label="Invitation URL" /><button type="button" onClick={() => navigator.clipboard?.writeText(inviteUrl)}>Copy</button></div>{invites.length > 0 && <div className="invite-list"><h3>Recent invitations</h3>{invites.map((entry) => <div key={entry.token_hash}><span>{entry.status} · {new Date(entry.created_at * 1000).toLocaleString()}</span>{entry.status === "active" && <button type="button" onClick={() => revoke(entry.token_hash)}>Revoke</button>}</div>)}</div>}</>
        : <form onSubmit={create}><p className="eyebrow">NEW CAMPAIGN</p><h2>Create your table</h2><label><span>Name</span><input required maxLength="100" value={name} onChange={(event) => setName(event.target.value)} placeholder="The Sunless Citadel" /></label><label><span>Game</span><select value={game} onChange={(event) => setGame(event.target.value)}><option value="dnd">D&amp;D</option><option value="mothership">Mothership</option></select></label><button type="submit">Create campaign</button></form>}
      {message && <p className="login-error" role="alert">{message}</p>}
    </section>}
    {!active ? <main className="empty-campaign"><section><p className="eyebrow">WELCOME ABOARD</p><h1>No campaigns yet</h1><p>Create a D&amp;D or Mothership campaign, or open an invitation from your DM.</p><button type="button" onClick={() => setOpen(true)}>Create your first campaign</button></section></main> : <Workspace onLogout={signOut} />}
  </>;
}

export default function App() {
  const [account, setAccount] = useState(null);
  const [phase, setPhase] = useState("loading");
  const [inviteError, setInviteError] = useState("");
  const query = useMemo(() => new URLSearchParams(window.location.search), []);
  const invite = useMemo(() => {
    if (window.location.pathname.startsWith("/invite/")) return window.location.pathname.slice(8);
    return new URLSearchParams(window.location.hash.slice(1)).get("invite") || "";
  }, []);
  const authMessage = { cancelled: "Discord sign-in was cancelled.", failed: "Sign-in failed or expired. Please try again." }[query.get("auth")] || "";
  const load = useCallback(async () => {
    try { setAccount(await sessionRequest("/api/auth/me")); setPhase("ready"); }
    catch (error) { setAccount(null); setPhase(error.status === 401 ? "anonymous" : "error"); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (phase !== "ready" || !invite) return;
    sessionRequest("/api/invitations/accept", { method: "POST", body: JSON.stringify({ token: invite }) })
      .then(() => { window.history.replaceState(null, "", "/"); return load(); })
      .catch((error) => { window.history.replaceState(null, "", "/?invite_error=1"); setInviteError(error.message || "This invitation is invalid or expired."); setPhase("invite-error"); });
  }, [phase, invite, load]);
  if (phase === "loading") return <section className="boot" aria-live="polite"><span>DM SCREEN</span><p>Opening your table…</p><div /></section>;
  if (phase === "anonymous" || phase === "error") return <Landing error={phase === "error" ? "The server is temporarily unavailable." : authMessage} invite={invite} />;
  if (phase === "invite-error") return <CampaignHome account={account} reload={load} initialMessage={inviteError} signOut={() => { setAccount(null); setPhase("anonymous"); }} />;
  return <CampaignHome account={account} reload={load} signOut={() => { setAccount(null); setPhase("anonymous"); }} />;
}
