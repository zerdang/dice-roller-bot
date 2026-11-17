# D&D table UI decisions

Updated November 1, 2026. Visual references are the user-supplied `img1.png` through `img4.png` in the workspace root.

## Approved visual contract

- Map remains mounted and fills the available workspace.
- Right sidebar defaults to 400 px, resizes between 340–520 px, collapses to a 52 px tab rail, and becomes an overlay below 1100 px.
- Sidebar tabs are Game Log, Tokens, and Scenes only. Selected tab, collapsed state, and width persist in browser storage by campaign.
- D&D surfaces use slate `#15191F`, panel `#202630`, raised `#2A323F`, text `#F1F5F9`, muted `#AAB6C5`, and teal `#55C8BB`. Styling is scoped to `.dnd-workspace`.
- The sheet is a map-preserving dialog up to 1200 px wide. Wide layout is 23% saves/senses/training, 25% skills, and 52% combat/details. It becomes two columns below 1200 px and one scrolling column below 720 px.

## Click semantics

- Roster identity opens an authorized sheet. Locate changes local selection/camera only.
- Scene name/Preview changes the DM's local scene. Show is separate and requires confirmation before activating the player scene.
- Ability, save, and skill buttons submit one normal server-resolved roll. Adjacent options expose advantage/disadvantage and a one-time bonus.
- Attack and damage are separate events. Neither applies damage or consumes a resource automatically.
- Manage mode exposes structured fields; Play mode emphasizes rolls and resource controls.

## Component map

- `DndWorkspace.jsx`: map-preserving workspace and sheet routing.
- `DndSidebar.jsx`: sidebar shell, log composer/cards, token roster, scene tree.
- `CharacterSheet.jsx`: responsive sheet shell, sections, tabs, editors, roll controls.
- `Battlemap.jsx`: local locate and DM-preview event integration.
- `functions/dnd.py`: additive sheet records, safe party summaries, canonical derived roll resolution.

## Checkpoint

Integrated UI1–UI4 implementation is present. Automated formula, privacy, persistence, regression, and build checks are required before UI5. Remaining live evidence: rendered screenshots at target breakpoints, two-player audience/network inspection, keyboard/focus walkthrough, and one DM plus five-player rehearsal.
