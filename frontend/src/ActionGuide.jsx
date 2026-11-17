import { COMMON_ACTIONS, characterActions, actionSlot, readTurn, RULES_URL, EQUIPMENT_URL } from "./dndActions.js";

export default function ActionGuide({ card, filter, busy, onTrack, onTab }) {
  const turn = readTurn(card.action_reminders);
  const matches = item => filter === "All" || (filter === "Attack" ? item.id === "attack" || item.name.startsWith("Attack:") || item.id === "opportunity" : filter === "Other" ? ["Other", "Interaction"].includes(item.category) : item.category === filter);
  const items = characterActions(card).filter(matches);
  const common = COMMON_ACTIONS.filter(matches);
  const row = item => {
    const slot = actionSlot(item.category);
    return <article className="action-reminder" key={item.id}>
      <details><summary><b>{item.name}</b><small>{item.category}</small></summary><p>{item.notes}</p>{item.tab && <button type="button" onClick={() => onTab(item.tab)}>Open {item.tab}</button>}</details>
      {slot && <button type="button" className="action-use" aria-label={`Mark ${item.name} used`} title={`Mark your ${item.category.toLowerCase()} used`} disabled={busy || turn[slot]} onClick={() => onTrack({ ...turn, [slot]: true })}>{turn[slot] ? "Used" : "Use"}</button>}
    </article>;
  };
  return <section className="action-guide" aria-label="2024 action guide">
    <div className="turn-tracker" role="group" aria-label="Turn tracker">{[["action", "Action"], ["bonus", "Bonus"], ["reaction", "Reaction"], ["interaction", "Interact"]].map(([key, label]) => <button type="button" key={key} aria-label={`${label} used`} aria-pressed={turn[key]} disabled={busy} onClick={() => onTrack({ ...turn, [key]: !turn[key] })}>{label}<span>{turn[key] ? "Used" : "Ready"}</span></button>)}<button type="button" disabled={busy} onClick={() => onTrack({ action: false, bonus: false, reaction: false, interaction: false })}>New turn</button></div>
    <p className="turn-help">Mark usage manually; reset on your turn. Spell slots, item quantities, and extra attacks are tracked separately.</p>
    {items.length > 0 && <details className="sheet-action-suggestions" open={filter !== "All" || undefined}><summary>From your sheet <span>({items.length})</span></summary><div className="action-reminder-grid">{items.map(row)}</div></details>}
    {common.length > 0 && <><h4>Common actions · 2024</h4><div className="action-reminder-grid">{common.map(row)}</div></>}
    <p className="action-rules-links"><a href={RULES_URL} target="_blank" rel="noreferrer">2024 action rules</a> · <a href={EQUIPMENT_URL} target="_blank" rel="noreferrer">Equipment uses</a></p>
  </section>;
}
