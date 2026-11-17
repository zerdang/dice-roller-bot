import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { signedModifier } from "./modifierBreakdown.js";

export default function ModifierTooltip({ id, anchor, data, onClose, onEnter, onLeave }) {
  const panel = useRef(null);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  useLayoutEffect(() => {
    const place = () => {
      const bounds = anchor.getBoundingClientRect();
      const box = panel.current.getBoundingClientRect();
      const left = Math.max(12, Math.min(bounds.left, window.innerWidth - box.width - 12));
      const below = bounds.bottom + 6;
      const top = Math.max(12, Math.min(below + box.height <= window.innerHeight - 12 ? below : bounds.top - box.height - 6, window.innerHeight - box.height - 12));
      setPosition({ left, top });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(panel.current);
    window.addEventListener("resize", place);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); };
  }, [anchor, data.heading]);
  useEffect(() => {
    const opened = performance.now();
    const escape = event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } };
    const scroll = event => { if (performance.now() - opened > 100 && !panel.current?.contains(event.target)) onClose(); };
    window.addEventListener("keydown", escape, true);
    window.addEventListener("scroll", scroll, true);
    return () => { window.removeEventListener("keydown", escape, true); window.removeEventListener("scroll", scroll, true); };
  }, [onClose, anchor]);
  return createPortal(<div id={id} ref={panel} role="tooltip" className="modifier-tooltip" style={position} onMouseEnter={onEnter} onMouseLeave={onLeave}>
    <strong>{data.heading}</strong>
    {data.heading !== data.ability && <p className="modifier-ability">{data.ability}</p>}
    <ul>{data.parts.map((part, index) => <li key={index}><b>{signedModifier(part.amount)}</b> from {part.label}</li>)}</ul>
    <div className="modifier-total">Total modifier <b>{signedModifier(data.total)}</b></div>
    {data.scoreParts.length > 0 && <p className="modifier-score-summary">Score points: {data.scoreParts.map((part, index) => `${index ? signedModifier(part.amount) : part.amount} ${part.label}`).join(" · ")}</p>}
    <small>{data.note}</small>
  </div>, document.body);
}
