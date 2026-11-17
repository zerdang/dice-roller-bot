import { useState } from "react";
import FantasyIcon from "./FantasyIcon.jsx";
import { groupPartyRoster } from "./party.js";

export default function PartyBrowser({ roster, role, activeName, onOpenSheet, onInspect, onActivate }) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState({});
  const [activating, setActivating] = useState(null);
  const [error, setError] = useState("");
  const groups = groupPartyRoster(roster, query);
  const isDm = role === "warden";
  const activate = async id => {
    setActivating(id); setError("");
    try { await onActivate(id); } catch (error) { setError(error.message); }
    finally { setActivating(null); }
  };
  return <section className="sidebar-pane party-pane">
    <header><div><h2><FantasyIcon name="people" /> Party</h2><p>{isDm ? "Your table, gathered together" : "Your companions and their characters"}</p></div></header>
    <input className="sidebar-search" type="search" placeholder="Find a player or character" aria-label="Search party" value={query} onChange={event => setQuery(event.target.value)} />
    <div className="sidebar-scroll party-groups">
      <p className={`party-access-note${isDm ? " dm-access" : ""}`}><FantasyIcon name={isDm ? "lock" : "shield"} />{isDm ? "DM access · All sheets and DM-private notes" : "Shared summaries · Only your sheets can be opened"}</p>
      {error && <p role="alert">{error}</p>}
      {groups.map(group => {
        const open = Boolean(query.trim()) || Boolean(expanded[group.key]);
        return <section className="party-player-group" key={group.key}>
          <button type="button" className="party-player-toggle" aria-expanded={open} aria-controls={`party-${group.key}`} onClick={() => setExpanded(current => ({ ...current, [group.key]: !open }))}>
            <span className="player-monogram" aria-hidden="true">{group.name.slice(0, 1)}</span>
            <span><b>{group.name}</b><small>{group.isDm ? "Dungeon Master" : group.isOwn ? "You" : "Player"} · {group.characters.length} {group.characters.length === 1 ? "character" : "characters"}</small></span>
            <span className="party-chevron" aria-hidden="true">{open ? "⌄" : "›"}</span>
          </button>
          <div id={`party-${group.key}`} hidden={!open} className="party-player-characters">
            {group.characters.map(card => <article className={`party-card${card.name === activeName ? " active-turn" : ""}`} key={card.id}>
              <div className="party-card-badges">{card.is_active && <span className="character-active-badge">✦ Active character</span>}{card.name === activeName && <span className="turn-chip">Current turn</span>}</div>
              <button type="button" className="party-identity" disabled={!card.can_open} onClick={() => onOpenSheet(card.id)}><span className="actor-fallback">{card.name.slice(0, 1)}</span><span><b>{card.name}</b><small>{[card.identity?.species, card.identity?.class_name, card.identity?.level ? `Level ${card.identity.level}` : ""].filter(Boolean).join(" · ") || "Adventurer"}</small></span></button>
              <small className="party-sheet-access"><FantasyIcon name={card.can_open ? "book" : "lock"} />{card.can_open ? isDm ? "Full sheet · DM access" : "Your character sheet" : "Shared summary only"}</small>
              <div className="party-stats"><span><b>{card.hp}/{card.max_hp}</b>Hit points</span><span><b>{card.armor_class}</b>Armor</span><span><b>{card.speed}</b>Speed</span><span><b>{card.passives?.Perception ?? "—"}</b>Perception</span></div>
              {card.conditions?.length > 0 && <p className="condition-summary"><b>Conditions:</b> {card.conditions.map(item => item.name).join(", ")}</p>}
              {card.updated_at && <small className="party-updated">Updated {new Date(card.updated_at).toLocaleString()}</small>}
              {card.is_own && !card.is_active && onActivate && <button type="button" className="party-set-active" disabled={activating !== null} onClick={() => activate(card.id)}>{activating === card.id ? "Setting active…" : "Set as active character"}</button>}
              <div className="party-actions"><button type="button" onClick={() => window.dispatchEvent(new CustomEvent("dnd-center-character", { detail: card.id }))}>Locate</button>{isDm && <button type="button" onClick={() => onInspect(card.id)}>Inspect</button>}{card.can_open && <button type="button" className="party-open-sheet" onClick={() => onOpenSheet(card.id)}><FantasyIcon name="book" /> Open sheet</button>}</div>
            </article>)}
          </div>
        </section>;
      })}
      {!groups.length && <p className="empty-state">No matching players or characters.</p>}
    </div>
  </section>;
}
