import { useEffect, useMemo, useState } from "react";
import Battlemap from "./Battlemap.jsx";

const ABILITIES = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];
const SKILLS = ["Acrobatics", "Animal Handling", "Arcana", "Athletics", "Deception", "History", "Insight", "Intimidation", "Investigation", "Medicine", "Nature", "Perception", "Performance", "Persuasion", "Religion", "Sleight of Hand", "Stealth", "Survival"];
const CONDITIONS = ["Blinded", "Charmed", "Deafened", "Exhaustion", "Frightened", "Grappled", "Incapacitated", "Invisible", "Paralyzed", "Petrified", "Poisoned", "Prone", "Restrained", "Stunned", "Unconscious"];
const REFERENCES = [
  ["Actions", "On your turn you normally move and take one action. Bonus actions and reactions are available only when a rule grants them."],
  ["Advantage / Disadvantage", "Roll two d20s and use the higher or lower result. Multiple sources do not add more d20s; advantage and disadvantage cancel."],
  ["Concentration", "Track concentration manually. Damage can call for a Constitution saving throw; the app does not adjudicate it."],
  ["Heroic Inspiration", "Spend it to reroll a die immediately after rolling. The app preserves and links both results; the player chooses the new result."],
  ["Surprise", "Surprise affects Initiative in the 2024 rules. There is no separate surprise round."],
  ["Grapple / Shove", "Use the 2024 Unarmed Strike options and saving throw procedure. Outcome and escape are manually adjudicated."],
  ["Hide", "Use the Hide action and 2024 visibility rules. The map does not automatically determine line of sight."],
  ["Areas", "Templates are visual measuring aids in scene units; targets and effects remain manual."],
];

const operationId = () => crypto.randomUUID();
const signed = (value) => `${Number(value) >= 0 ? "+" : ""}${Number(value) || 0}`;

function DndFeed({ rolls }) {
  return <section className="dnd-side-panel"><h3>Roll feed</h3><div className="dnd-feed">{rolls.length ? rolls.map((roll) => <article key={roll.id}>
    <b>{roll.actor_name} · {roll.label}</b><span>{roll.expression} → <strong>{roll.total}</strong></span>
    <small>{roll.mode}{roll.audience !== "public" ? ` · ${roll.audience}` : ""}{roll.parent_roll_id ? ` · reroll of #${roll.parent_roll_id}` : ""}</small>
  </article>) : <p>No browser rolls yet.</p>}</div></section>;
}

function Tracker({ entries }) {
  return <section className="dnd-side-panel"><h3>Turn order</h3><ol className="dnd-turns">{entries.map((entry) => <li key={entry.id}><button type="button" onClick={() => window.dispatchEvent(new CustomEvent("dnd-center-turn", { detail: entry.id }))}>{entry.name}</button><small>{entry.kind}</small></li>)}</ol></section>;
}

function ReferencePanel() {
  const [query, setQuery] = useState("");
  const results = REFERENCES.filter(([title, body]) => `${title} ${body}`.toLowerCase().includes(query.toLowerCase()));
  return <details className="dnd-reference"><summary>2024 rules reference</summary><label>Search<input value={query} onChange={(event) => setQuery(event.target.value)} /></label><p className="manual-note">D&D 5e — 2024 rules · SRD 5.2.1 subset. Adjudication remains with the table.</p>{results.map(([title, body]) => <article key={title}><h4>{title}</h4><p>{body}</p></article>)}<details><summary>Condition names</summary><p>{CONDITIONS.join(" · ")}</p></details></details>;
}

function NumberField({ label, value, onChange, min, max }) {
  return <label>{label}<input type="number" value={value ?? 0} min={min} max={max} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function CombatCard({ initial, rolls, role, request, refresh, reportError }) {
  const [card, setCard] = useState(initial);
  const [roll, setRoll] = useState({ label: "Custom roll", kind: "custom", expression: "1d20", mode: "normal", audience: "public" });
  const [busy, setBusy] = useState(false);
  useEffect(() => setCard(initial), [initial]);
  const change = (key, value) => setCard((old) => ({ ...old, [key]: value }));
  const save = async (patch = {}) => {
    try {
      setBusy(true);
      const result = await request(`/api/dnd/characters/${card.id}`, { method: "PATCH", body: JSON.stringify({ revision: card.revision, ...patch }) });
      setCard(result);
    } catch (error) { reportError(error); await refresh(true); } finally { setBusy(false); }
  };
  const delta = async (field, amount) => {
    try {
      const result = await request(`/api/dnd/characters/${card.id}/resources`, { method: "POST", body: JSON.stringify({ field, delta: amount, operation_id: operationId() }) });
      setCard(result);
    } catch (error) { reportError(error); }
  };
  const makeRoll = async (overrides = {}) => {
    try {
      setBusy(true);
      await request(`/api/dnd/characters/${card.id}/rolls`, { method: "POST", body: JSON.stringify({ ...roll, ...overrides, operation_id: operationId() }) });
      await refresh(true);
    } catch (error) { reportError(error); } finally { setBusy(false); }
  };
  const lastOwnRoll = useMemo(() => rolls.find((item) => item.character_id === card.id && !item.parent_roll_id), [rolls, card.id]);
  const updateMap = (key, name, value) => change(key, { ...(card[key] || {}), [name]: value });
  const addListItem = (key, item) => change(key, [...(card[key] || []), item]);
  const updateListItem = (key, index, patch) => change(key, card[key].map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));

  return <article className="dnd-card">
    <header><div><p className="index">D&D 5e — 2024 rules</p><h3>{card.name}</h3></div><span>{busy ? "SAVING" : `REV ${card.revision}`}</span></header>
    <div className="dnd-card-grid">
      <NumberField label="AC" value={card.armor_class} onChange={(value) => change("armor_class", value)} />
      <NumberField label="Speed" value={card.speed} onChange={(value) => change("speed", value)} />
      <NumberField label="Initiative" value={card.initiative_modifier} onChange={(value) => change("initiative_modifier", value)} />
      <NumberField label="Spell DC" value={card.spell_save_dc} onChange={(value) => change("spell_save_dc", value)} />
      <NumberField label="Spell attack" value={card.spell_attack_modifier} onChange={(value) => change("spell_attack_modifier", value)} />
      <NumberField label="Current HP" value={card.hp} min="0" onChange={(value) => change("hp", value)} />
      <NumberField label="Maximum HP" value={card.max_hp} min="1" onChange={(value) => change("max_hp", value)} />
      <button type="button" onClick={() => makeRoll({ kind: "initiative", label: "Initiative", expression: `1d20${signed(card.initiative_modifier)}` })}>Roll initiative</button>
      <button type="button" onClick={() => save({ armor_class: card.armor_class, speed: card.speed, initiative_modifier: card.initiative_modifier, spell_save_dc: card.spell_save_dc, spell_attack_modifier: card.spell_attack_modifier, hp: card.hp, max_hp: card.max_hp })}>Save basics</button>
    </div>
    <section className="dnd-resources"><h4>Canonical resources</h4>
      <div><b>HP {card.hp}/{card.max_hp}</b><button onClick={() => delta("hp", -1)}>−</button><button onClick={() => delta("hp", 1)}>+</button></div>
      <div><b>Temp {card.temp_hp}</b><button onClick={() => delta("temp_hp", -1)}>−</button><button onClick={() => delta("temp_hp", 1)}>+</button></div>
      <div><b>Death ✓ {card.death_successes}</b><button onClick={() => delta("death_successes", -1)}>−</button><button onClick={() => delta("death_successes", 1)}>+</button></div>
      <div><b>Death ✕ {card.death_failures}</b><button onClick={() => delta("death_failures", -1)}>−</button><button onClick={() => delta("death_failures", 1)}>+</button></div>
      <label><input type="checkbox" checked={Boolean(card.heroic_inspiration)} onChange={(event) => save({ heroic_inspiration: event.target.checked ? 1 : 0 })} /> Heroic Inspiration</label>
      <label><input type="checkbox" checked={Boolean(card.concentrating)} onChange={(event) => save({ concentrating: event.target.checked ? 1 : 0 })} /> Concentrating</label>
      <label>Exhaustion <select value={card.exhaustion} onChange={(event) => save({ exhaustion: Number(event.target.value) })}>{[0,1,2,3,4,5,6].map((level) => <option key={level}>{level}</option>)}</select></label>
    </section>
    <section><h4>Abilities, saves & skills</h4><div className="ability-grid">{ABILITIES.map((ability) => <div key={ability}><b>{ability.slice(0,3).toUpperCase()}</b><input aria-label={`${ability} modifier`} type="number" value={card.abilities?.[ability] || 0} onChange={(event) => updateMap("abilities", ability, Number(event.target.value))} /><button onClick={() => makeRoll({ label: `${ability} check`, kind: "ability", expression: `1d20${signed(card.abilities?.[ability])}` })}>Roll</button><input aria-label={`${ability} save modifier`} type="number" value={card.saves?.[ability] || 0} onChange={(event) => updateMap("saves", ability, Number(event.target.value))} /><button onClick={() => makeRoll({ label: `${ability} save`, kind: "save", expression: `1d20${signed(card.saves?.[ability])}` })}>Save</button></div>)}</div><button onClick={() => save({ abilities: card.abilities, saves: card.saves })}>Save modifiers</button></section>
    <details><summary>Skill modifiers</summary><div className="skill-grid">{SKILLS.map((skill) => <div key={skill}><label>{skill}<input type="number" value={card.skills?.[skill] || 0} onChange={(event) => updateMap("skills", skill, Number(event.target.value))} /></label><button type="button" onClick={() => makeRoll({ label: `${skill} check`, kind: "skill", expression: `1d20${signed(card.skills?.[skill])}` })}>Roll</button></div>)}</div><button onClick={() => save({ skills: card.skills })}>Save skills</button></details>
    <section><h4>Roll</h4><div className="roll-composer"><input value={roll.label} aria-label="Roll label" onChange={(event) => setRoll({ ...roll, label: event.target.value })} /><input value={roll.expression} aria-label="Dice expression" onChange={(event) => setRoll({ ...roll, expression: event.target.value })} /><select value={roll.mode} aria-label="Roll mode" onChange={(event) => setRoll({ ...roll, mode: event.target.value })}><option value="normal">Normal</option><option value="advantage">Advantage</option><option value="disadvantage">Disadvantage</option></select><select value={roll.audience} aria-label="Audience" onChange={(event) => setRoll({ ...roll, audience: event.target.value })}><option value="public">Public</option><option value="private">Private (player + DM)</option>{role === "warden" && <option value="dm">DM only</option>}</select><button onClick={() => makeRoll()}>Roll</button>{lastOwnRoll && Boolean(card.heroic_inspiration) && <button onClick={() => makeRoll({ kind: lastOwnRoll.kind, label: `${lastOwnRoll.label} (Inspiration reroll)`, expression: lastOwnRoll.expression, mode: lastOwnRoll.mode, audience: lastOwnRoll.audience, parent_roll_id: lastOwnRoll.id })}>Use Inspiration to reroll #{lastOwnRoll.id}</button>}</div><p className="manual-note">Attacks, damage types, hits, saves, effects, and resource use are manually adjudicated.</p></section>
    <details><summary>Attacks & damage</summary>{card.attacks.map((attack, index) => <div className="dnd-list-row" key={index}><input placeholder="Name" value={attack.name || ""} onChange={(event) => updateListItem("attacks", index, { name: event.target.value })} /><input placeholder="Attack bonus" type="number" value={attack.bonus || 0} onChange={(event) => updateListItem("attacks", index, { bonus: Number(event.target.value) })} /><input placeholder="Damage, e.g. 1d8+3" value={attack.damage || ""} onChange={(event) => updateListItem("attacks", index, { damage: event.target.value })} /><button onClick={() => makeRoll({ kind: "attack", label: `${attack.name} attack`, expression: `1d20${signed(attack.bonus)}` })}>Attack</button><button onClick={() => makeRoll({ kind: "damage", label: `${attack.name} damage`, expression: attack.damage })}>Damage</button></div>)}<button onClick={() => addListItem("attacks", { name: "New attack", bonus: 0, damage: "1d6" })}>Add attack</button><button onClick={() => save({ attacks: card.attacks })}>Save attacks</button></details>
    <details><summary>Spell slots & custom resources</summary><div className="spell-grid">{[1,2,3,4,5,6,7,8,9].map((level) => { const pool = card.spell_slots?.[level] || { current: 0, max: 0 }; return <label key={level}>L{level}<input type="number" min="0" value={pool.current} onChange={(event) => updateMap("spell_slots", level, { ...pool, current: Number(event.target.value) })} /> / <input type="number" min="0" value={pool.max} onChange={(event) => updateMap("spell_slots", level, { ...pool, max: Number(event.target.value) })} /></label>; })}</div>{card.resources.map((resource, index) => <div className="dnd-list-row" key={index}><input value={resource.name || ""} onChange={(event) => updateListItem("resources", index, { name: event.target.value })} /><input type="number" value={resource.current || 0} onChange={(event) => updateListItem("resources", index, { current: Number(event.target.value) })} /><span>/</span><input type="number" value={resource.max || 0} onChange={(event) => updateListItem("resources", index, { max: Number(event.target.value) })} /></div>)}<button onClick={() => addListItem("resources", { name: "Custom pool", current: 1, max: 1 })}>Add pool</button><button onClick={() => save({ spell_slots: card.spell_slots, resources: card.resources })}>Save resources</button></details>
    <details><summary>Features, actions & notes</summary>{card.features.map((feature, index) => <div className="dnd-list-row" key={index}><input placeholder="Feature" value={feature.name || ""} onChange={(event) => updateListItem("features", index, { name: event.target.value })} /><input placeholder="Uses" type="number" value={feature.uses || 0} onChange={(event) => updateListItem("features", index, { uses: Number(event.target.value) })} /><input placeholder="Notes / mastery reminder" value={feature.notes || ""} onChange={(event) => updateListItem("features", index, { notes: event.target.value })} /></div>)}<button onClick={() => addListItem("features", { name: "Custom feature", uses: 1, notes: "" })}>Add feature</button><div className="action-reminders">{["action", "bonus_action", "reaction"].map((name) => <label key={name}>{name.replace("_", " ")}<input value={card.action_reminders?.[name] || ""} onChange={(event) => updateMap("action_reminders", name, event.target.value)} /></label>)}</div><textarea value={card.notes} placeholder="Spell notes and other manual reminders" onChange={(event) => change("notes", event.target.value)} /><button onClick={() => save({ features: card.features, action_reminders: card.action_reminders, notes: card.notes })}>Save notes</button></details>
  </article>;
}

export default function DndWorkspace({ dashboard, request, refresh, reportError }) {
  const [tab, setTab] = useState("map");
  return <main className="dnd-workspace">
    <nav className="dnd-tabs" aria-label="D&D workspace"><button className={tab === "map" ? "active" : ""} onClick={() => setTab("map")}>Map</button><button className={tab === "cards" ? "active" : ""} onClick={() => setTab("cards")}>Combat cards</button><button className={tab === "reference" ? "active" : ""} onClick={() => setTab("reference")}>Reference</button></nav>
    {tab === "map" && <div className="dnd-map-shell"><Battlemap dashboard={dashboard} request={request} reportError={reportError} /><aside className="dnd-rail"><Tracker entries={dashboard.turn_order} /><DndFeed rolls={dashboard.dnd_rolls || []} /><ReferencePanel /></aside></div>}
    {tab === "cards" && <section className="dnd-cards">{(dashboard.dnd_characters || []).map((card) => <CombatCard key={card.id} initial={card} rolls={dashboard.dnd_rolls || []} role={dashboard.role} request={request} refresh={refresh} reportError={reportError} />)}</section>}
    {tab === "reference" && <ReferencePanel />}
  </main>;
}
