import { useState } from "react";

const ABILITIES = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];
export default function AbilitySourcesEditor({ card, onChange }) {
  const [ability, setAbility] = useState("strength");
  const source = card.ability_sources?.[ability] || { base: card.ability_scores?.[ability] ?? 10, increases: [] };
  const update = next => onChange({ ...(card.ability_sources || {}), [ability]: next });
  return <details className="ability-sources-editor"><summary>Score sources</summary><p>Describe point increases already included in the score above.</p>
    <div className="source-editor-fields"><label>Ability<select value={ability} onChange={event => setAbility(event.target.value)}>{ABILITIES.map(name => <option key={name} value={name}>{name}</option>)}</select></label><label>Base Points<input type="number" min="1" max="30" value={source.base} onChange={event => { const base = Number(event.target.value); if (Number.isInteger(base) && base >= 1 && base <= 30) update({ ...source, base }); }} /></label></div>
    {source.increases.map((item, index) => <div className="source-editor-fields" key={index}><label>Source name<input maxLength={100} value={item.label} placeholder="Species Points / XYZ Equipment" onChange={event => update({ ...source, increases: source.increases.map((row, i) => i === index ? { ...row, label: event.target.value } : row) })} /></label><label>Score points<input type="number" min="-30" max="30" value={item.points} onChange={event => { const points = Number(event.target.value); if (Number.isInteger(points) && Math.abs(points) <= 30) update({ ...source, increases: source.increases.map((row, i) => i === index ? { ...row, points } : row) }); }} /></label><button type="button" onClick={() => update({ ...source, increases: source.increases.filter((_, i) => i !== index) })}>Remove source</button></div>)}
    <button type="button" disabled={source.increases.length >= 12} onClick={() => update({ ...source, increases: [...source.increases, { label: "Equipment Points", points: 0 }] })}>Add score source</button>
  </details>;
}
