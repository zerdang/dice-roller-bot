const paths = {
  compass: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="6.5" /><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2M12 4l2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" /><path d="m9 15 6-6-2 4Z" /></>,
  star: <><path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z" /><circle cx="12" cy="12" r="3" /></>,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" /><path d="M12 7v10m-4-5h8" /></>,
  sword: <><path d="m5 20 11-11 3-6-6 3L2 17m2-5 8 8M3 21l3-3" /></>,
  spell: <><path d="M5 20 18 7M14 3v4m-2-2h4M20 12v4m-2-2h4M5 4v4M3 6h4" /><path d="m13 10 3 3" /></>,
  pack: <><rect x="5" y="7" width="14" height="14" rx="3" /><path d="M9 7V5a3 3 0 0 1 6 0v2M5 12h14M10 11v4h4v-4M9 18h6" /></>,
  leaf: <><path d="M5 19c-6-12 8-9 14-16 2 13-3 20-12 14M5 21 16 8" /></>,
  quill: <><path d="M4 21 18 4c8 0 1 11-6 12l-3-2M4 21h12M11 10l3 2" /></>,
  book: <><path d="M12 6c-3-3-7-3-10-2v15c4-1 7 0 10 2 3-2 6-3 10-2V4c-3-1-7-1-10 2Zm0 0v15M5 8h4m-4 4h4m6-4h4m-4 4h4" /></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v2" /></>,
  people: <><circle cx="9" cy="7" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m1 4c3 0 4 3 4 6" /></>,
};

export default function FantasyIcon({ name = "star" }) {
  return <svg className="fantasy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.star}</svg>;
}
