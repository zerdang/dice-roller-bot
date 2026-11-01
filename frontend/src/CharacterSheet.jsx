import { useEffect, useMemo, useRef, useState } from "react";

const ABILITIES = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];
const SKILL_ABILITY = {
  "Acrobatics": "dexterity", "Animal Handling": "wisdom", "Arcana": "intelligence", "Athletics": "strength",
  "Deception": "charisma", "History": "intelligence", "Insight": "wisdom", "Intimidation": "charisma",
  "Investigation": "intelligence", "Medicine": "wisdom", "Nature": "intelligence", "Perception": "wisdom",
  "Performance": "charisma", "Persuasion": "charisma", "Religion": "intelligence", "Sleight of Hand": "dexterity",
  "Stealth": "dexterity", "Survival": "wisdom",
};
const TABS = ["Actions", "Spells", "Inventory", "Features & Traits", "Background", "Notes"];
const signed = (value) => `${value >= 0 ? "+" : ""}${value}`;
const abilityMod = (score) => Math.floor(((Number(score) || 10) - 10) / 2);
const operationId = () => crypto.randomUUID();

function RollButton({ label, onRoll }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("normal");
  const [bonus, setBonus] = useState(0);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close);
  }, [open]);
  const submit = () => { onRoll(mode, bonus); setMode("normal"); setBonus(0); setOpen(false); };
  return <span className="sheet-roll-control"><button type="button" className="sheet-roll" onClick={() => onRoll("normal", 0)}>{label}</button><button type="button" className="roll-options" aria-label={`${label} roll options`} aria-expanded={open} onClick={() => setOpen(!open)}>▾</button>{open && <span className="roll-popover"><select aria-label="Roll mode" value={mode} onChange={(event) => setMode(event.target.value)}><option value="normal">Normal</option><option value="advantage">Advantage</option><option value="disadvantage">Disadvantage</option></select><input aria-label="One-time bonus" type="number" value={bonus} onChange={(event) => setBonus(Number(event.target.value))} /><button type="button" onClick={submit}>Roll</button></span>}</span>;
}

function ListEditor({ items, fields, onChange, addLabel }) {
  const update = (index, key, value) => onChange(items.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item));
  return <div className="sheet-list-editor">{items.map((item, index) => <article key={item.id || index}>{fields.map((field) => <label key={field.key}>{field.label}<input type={field.type || "text"} value={item[field.key] ?? ""} onChange={(event) => update(index, field.key, field.type === "number" ? Number(event.target.value) : field.type === "checkbox" ? event.target.checked : event.target.value)} /></label>)}<button type="button" aria-label={`Remove ${item.name || "entry"}`} onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}>Remove</button></article>)}<button type="button" onClick={() => onChange([...items, { id: operationId(), name: `New ${addLabel.toLowerCase()}` }])}>Add {addLabel}</button></div>;
}

export default function CharacterSheet({ initial, role, audience, request, refresh, reportError, onClose }) {
  const [card, setCard] = useState(initial);
  const [manage, setManage] = useState(false);
  const [tab, setTab] = useState("Actions");
  const [status, setStatus] = useState("Saved");
  const [result, setResult] = useState(null);
  const [maximized, setMaximized] = useState(false);
  const closeRef = useRef(null);
  useEffect(() => { setCard(initial); }, [initial]);
  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      if (document.querySelector(".roll-popover")) return;
      if (status === "Saved" || window.confirm("Discard unsaved changes?")) onClose();
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [onClose, status]);
  const change = (key, value) => { setCard((old) => ({ ...old, [key]: value })); setStatus("Unsaved"); };
  const mapChange = (key, name, value) => change(key, { ...(card[key] || {}), [name]: value });
  const save = async (patch) => {
    setStatus("Saving…");
    try {
      const saved = await request(`/api/dnd/characters/${card.id}`, { method: "PATCH", body: JSON.stringify({ revision: card.revision, ...patch }) });
      setCard(saved); setStatus("Saved"); await refresh(true);
    } catch (error) { setStatus("Save failed"); reportError(error); }
  };
  const delta = async (field, amount) => {
    try {
      const saved = await request(`/api/dnd/characters/${card.id}/resources`, { method: "POST", body: JSON.stringify({ field, delta: amount, operation_id: operationId() }) });
      setCard(saved); setStatus("Saved"); await refresh(true);
    } catch (error) { reportError(error); }
  };
  const rollField = async (fieldType, name, mode = "normal", bonus = 0) => {
    try {
      const rolled = await request(`/api/dnd/characters/${card.id}/sheet-rolls`, { method: "POST", body: JSON.stringify({ field_type: fieldType, name, mode, bonus, audience, operation_id: operationId() }) });
      setResult(rolled); await refresh(true);
    } catch (error) { reportError(error); }
  };
  const rollExpression = async (kind, label, expression) => {
    try {
      const rolled = await request(`/api/dnd/characters/${card.id}/rolls`, { method: "POST", body: JSON.stringify({ kind, label, expression, mode: "normal", audience, operation_id: operationId() }) });
      setResult(rolled); await refresh(true);
    } catch (error) { reportError(error); }
  };
  const score = (ability) => Number(card.ability_scores?.[ability] ?? 10);
  const computed = (name, ability, collection) => {
    const training = card[collection]?.[name] || {};
    const value = abilityMod(score(ability)) + Number(card.proficiency_bonus || 2) * Number(training.tier || 0) + Number(training.adjustment || 0);
    return training.override === null || training.override === undefined || training.override === "" ? value : Number(training.override);
  };
  const passive = (skill) => 10 + computed(skill, SKILL_ABILITY[skill], "skill_training");
  const identity = card.identity || {};
  const attacks = card.attacks || [];
  const spells = card.spells || [];
  const inventory = card.inventory || [];
  const features = card.features || [];
  const dirtyPatch = useMemo(() => ({
    proficiency_bonus: card.proficiency_bonus, ability_scores: card.ability_scores, save_training: card.save_training,
    skill_training: card.skill_training, identity: card.identity, senses: card.senses, training: card.training,
    armor_class: card.armor_class, speed: card.speed, initiative_modifier: card.initiative_modifier,
    spell_save_dc: card.spell_save_dc, spell_attack_modifier: card.spell_attack_modifier,
    hp: card.hp, max_hp: card.max_hp, conditions: card.conditions, attacks: card.attacks, spells: card.spells,
    inventory: card.inventory, features: card.features, background: card.background, notes: card.notes,
    spell_slots: card.spell_slots, resources: card.resources, ...(role === "warden" ? { dm_notes: card.dm_notes || "" } : {}),
  }), [card, role]);

  return <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && status === "Saved") onClose(); }}><section className={`character-sheet${maximized ? " maximized" : ""}`} role="dialog" aria-modal="true" aria-label={`${card.name} character sheet`}>
    <header className="sheet-header"><div className="sheet-portrait" aria-hidden="true">{card.name.slice(0, 1)}</div><div><p>D&D 5e — 2024 rules</p><h2>{card.name}</h2><span>{[identity.species, identity.class_name, identity.level ? `Level ${identity.level}` : ""].filter(Boolean).join(" · ") || "Manual character"}</span></div><span className={`save-status ${status.replace(/\W/g, "-").toLowerCase()}`}>{status}</span><button type="button" onClick={() => setManage(!manage)}>{manage ? "Play" : "Manage"}</button>{manage && <button type="button" onClick={() => save(dirtyPatch)}>Save changes</button>}<button type="button" onClick={() => setMaximized(!maximized)}>{maximized ? "Restore" : "Maximize"}</button><button ref={closeRef} type="button" onClick={() => status === "Saved" || window.confirm("Discard unsaved changes?") ? onClose() : null}>Close</button></header>
    {manage && <section className="identity-editor"><label>Species<input value={identity.species || ""} onChange={(event) => mapChange("identity", "species", event.target.value)} /></label><label>Class / subclass<input value={identity.class_name || ""} onChange={(event) => mapChange("identity", "class_name", event.target.value)} /></label><label>Level label<input value={identity.level || ""} onChange={(event) => mapChange("identity", "level", event.target.value)} /></label><label>Background<input value={identity.background || ""} onChange={(event) => mapChange("identity", "background", event.target.value)} /></label></section>}
    <section className="ability-strip">{ABILITIES.map((ability) => <article key={ability}><b>{ability.slice(0, 3).toUpperCase()}</b>{manage ? <input aria-label={`${ability} score`} type="number" min="1" max="30" value={score(ability)} onChange={(event) => mapChange("ability_scores", ability, Number(event.target.value))} /> : <strong>{signed(abilityMod(score(ability)))}</strong>}<small>{score(ability)}</small><RollButton label="Check" onRoll={(mode, bonus) => rollField("ability", ability, mode, bonus)} /></article>)}<article className="proficiency-tile"><b>Proficiency</b>{manage ? <input type="number" min="0" max="12" value={card.proficiency_bonus} onChange={(event) => change("proficiency_bonus", Number(event.target.value))} /> : <strong>{signed(card.proficiency_bonus)}</strong>}<small>Bonus</small></article><article><b>Walking</b>{manage ? <input type="number" value={card.speed} onChange={(event) => change("speed", Number(event.target.value))} /> : <strong>{card.speed}</strong>}<small>feet</small></article><article className="inspiration-tile"><label><input type="checkbox" checked={Boolean(card.heroic_inspiration)} onChange={(event) => save({ heroic_inspiration: event.target.checked ? 1 : 0 })} /> Heroic Inspiration</label></article><article className="death-tile"><b>Death saves</b><span>Success {card.death_successes}/3</span><span>Failure {card.death_failures}/3</span></article></section>
    {result && <div className="inline-roll" role="status"><b>{result.label}</b><span>{result.expression} → {result.total}</span><button type="button" aria-label="Dismiss roll result" onClick={() => setResult(null)}>×</button></div>}
    <div className="sheet-body"><aside className="sheet-left"><section><h3>Saving Throws</h3>{ABILITIES.map((ability) => { const value = computed(ability, ability, "save_training"); const training = card.save_training?.[ability] || {}; return <div className="save-row" key={ability}>{manage && <select aria-label={`${ability} save proficiency`} value={training.tier || 0} onChange={(event) => mapChange("save_training", ability, { ...training, tier: Number(event.target.value) })}><option value="0">○</option><option value="1">●</option></select>}<span>{ability.slice(0, 3).toUpperCase()}</span><RollButton label={signed(value)} onRoll={(mode, bonus) => rollField("save", ability, mode, bonus)} /></div>; })}</section><section><h3>Senses</h3><p><b>{passive("Perception")}</b> Passive Perception</p><p><b>{passive("Investigation")}</b> Passive Investigation</p><p><b>{passive("Insight")}</b> Passive Insight</p>{manage ? <textarea value={card.senses?.other || ""} onChange={(event) => mapChange("senses", "other", event.target.value)} placeholder="Darkvision, tremorsense…" /> : <p>{card.senses?.other || "No additional senses"}</p>}</section><section><h3>Proficiencies & Training</h3>{["armor", "weapons", "tools", "languages"].map((field) => <div key={field}><b>{field}</b>{manage ? <textarea value={card.training?.[field] || ""} onChange={(event) => mapChange("training", field, event.target.value)} /> : <p>{card.training?.[field] || "Not entered"}</p>}</div>)}</section></aside>
      <section className="sheet-skills"><h3>Skills</h3>{Object.entries(SKILL_ABILITY).map(([skill, ability]) => { const training = card.skill_training?.[skill] || {}; const value = computed(skill, ability, "skill_training"); return <div className="skill-row" key={skill}>{manage ? <select aria-label={`${skill} proficiency`} value={training.tier || 0} onChange={(event) => mapChange("skill_training", skill, { ...training, tier: Number(event.target.value) })}><option value="0">○</option><option value="1">●</option><option value="2">◆</option></select> : <span className="training-mark">{Number(training.tier) === 2 ? "◆" : Number(training.tier) === 1 ? "●" : "○"}</span>}<small>{ability.slice(0, 3).toUpperCase()}</small><span>{skill}</span><RollButton label={signed(value)} onRoll={(mode, bonus) => rollField("skill", skill, mode, bonus)} />{manage && <input className="override-input" aria-label={`${skill} override`} type="number" placeholder="Override" value={training.override ?? ""} onChange={(event) => mapChange("skill_training", skill, { ...training, override: event.target.value === "" ? null : Number(event.target.value) })} />}</div>; })}</section>
      <main className="sheet-main"><section className="combat-summary"><article><b>Initiative</b><strong>{signed(card.initiative_modifier)}</strong><button type="button" onClick={() => rollExpression("initiative", "Initiative", `1d20${signed(card.initiative_modifier)}`)}>Roll</button></article><article><b>Armor Class</b>{manage ? <input type="number" value={card.armor_class} onChange={(event) => change("armor_class", Number(event.target.value))} /> : <strong>{card.armor_class}</strong>}</article><article className="hp-summary"><b>Hit Points</b><strong>{card.hp} / {card.max_hp}</strong><span>{card.temp_hp ? `${card.temp_hp} temporary` : "No temporary HP"}</span><button type="button" onClick={() => delta("hp", -1)}>−</button><button type="button" onClick={() => delta("hp", 1)}>+</button></article><article><b>Conditions</b><span>{(card.conditions || []).map((item) => item.name).join(", ") || "None"}</span><label><input type="checkbox" checked={Boolean(card.concentrating)} onChange={(event) => save({ concentrating: event.target.checked ? 1 : 0 })} /> Concentrating</label><span>Exhaustion {card.exhaustion}</span></article></section>
        <nav className="sheet-tabs" aria-label="Character details">{TABS.map((name) => <button type="button" className={tab === name ? "active" : ""} onClick={() => setTab(name)} key={name}>{name}</button>)}</nav><section className="sheet-tab-panel">
          {tab === "Actions" && <div><div className="action-filters"><button type="button">All</button><button type="button">Attack</button><button type="button">Action</button><button type="button">Bonus Action</button><button type="button">Reaction</button><button type="button">Other</button></div>{manage ? <ListEditor items={attacks} onChange={(value) => change("attacks", value)} addLabel="Action" fields={[{ key: "name", label: "Name" }, { key: "category", label: "Category" }, { key: "range", label: "Range" }, { key: "bonus", label: "Hit bonus", type: "number" }, { key: "damage", label: "Damage" }, { key: "notes", label: "Notes" }]} /> : attacks.length ? attacks.map((attack, index) => <article className="action-card" key={attack.id || index}><div><b>{attack.name}</b><small>{attack.category || "Attack"} · {attack.range || "Manual range"}</small><p>{attack.notes}</p></div><button type="button" onClick={() => rollExpression("attack", `${attack.name} attack`, `1d20${signed(Number(attack.bonus || 0))}`)}>{signed(Number(attack.bonus || 0))} Hit</button><button type="button" onClick={() => rollExpression("damage", `${attack.name} damage`, attack.damage || "1d4")}>{attack.damage || "Damage"}</button></article>) : <p className="empty-state">No actions entered. Use Manage to add attacks and other actions.</p>}</div>}
          {tab === "Spells" && <div><div className="slot-row">{[1,2,3,4,5,6,7,8,9].map((level) => { const pool = card.spell_slots?.[level] || { current: 0, max: 0 }; return <span key={level}>L{level} {pool.current}/{pool.max}</span>; })}</div>{manage ? <ListEditor items={spells} onChange={(value) => change("spells", value)} addLabel="Spell" fields={[{ key: "name", label: "Name" }, { key: "level", label: "Level", type: "number" }, { key: "casting_time", label: "Casting time" }, { key: "range", label: "Range" }, { key: "damage", label: "Damage / healing" }, { key: "notes", label: "Notes" }]} /> : spells.length ? spells.map((spell, index) => <article className="action-card" key={spell.id || index}><div><b>{spell.name}</b><small>Level {spell.level || 0} · {spell.casting_time || "Manual casting time"} · {spell.range || "Manual range"}</small><p>{spell.notes}</p></div>{spell.damage && <button type="button" onClick={() => rollExpression("damage", spell.name, spell.damage)}>{spell.damage}</button>}</article>) : <p className="empty-state">No spells configured for this character.</p>}</div>}
          {tab === "Inventory" && (manage ? <ListEditor items={inventory} onChange={(value) => change("inventory", value)} addLabel="Item" fields={[{ key: "name", label: "Name" }, { key: "quantity", label: "Quantity", type: "number" }, { key: "weight", label: "Weight", type: "number" }, { key: "notes", label: "Notes" }]} /> : <div className="inventory-sheet-list">{inventory.length ? inventory.map((item, index) => <article key={item.id || index}><b>{item.name}</b><span>×{item.quantity || 1}</span><small>{item.notes}</small></article>) : <p className="empty-state">No inventory entered.</p>}</div>)}
          {tab === "Features & Traits" && (manage ? <ListEditor items={features} onChange={(value) => change("features", value)} addLabel="Feature" fields={[{ key: "name", label: "Name" }, { key: "uses", label: "Uses", type: "number" }, { key: "notes", label: "Description" }]} /> : <div>{features.length ? features.map((feature, index) => <details key={feature.id || index}><summary>{feature.name} {feature.uses != null ? `(${feature.uses} uses)` : ""}</summary><p>{feature.notes}</p></details>) : <p className="empty-state">No features entered.</p>}</div>)}
          {tab === "Background" && <div className="background-fields">{["appearance", "personality", "history"].map((field) => <label key={field}>{field}{manage ? <textarea value={card.background?.[field] || ""} onChange={(event) => mapChange("background", field, event.target.value)} /> : <p>{card.background?.[field] || "Not entered"}</p>}</label>)}</div>}
          {tab === "Notes" && <div className="notes-fields"><label>Player notes<textarea value={card.notes || ""} readOnly={!manage} onChange={(event) => change("notes", event.target.value)} onBlur={() => manage && save({ notes: card.notes })} /></label>{role === "warden" && <label>DM-private notes<textarea value={card.dm_notes || ""} readOnly={!manage} onChange={(event) => change("dm_notes", event.target.value)} onBlur={() => manage && save({ dm_notes: card.dm_notes })} /></label>}</div>}
        </section>
      </main></div>
  </section></div>;
}
