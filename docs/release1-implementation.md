# Releases 1–3 implementation record — through P1B

Recorded October 29, 2026 at baseline commit `ad26937` (`Add Discord OAuth website authentication`). Scope stops after P1B/C2; no Release 2 or 3 behavior is included.

## P0 baseline and decisions

- Existing: Discord OAuth sessions and campaign membership, legacy bearer compatibility, game-separated campaigns, D&D scenes/assets/grid/tokens/annotations/presets, revision conflicts, retry keys, undo, polling, Mothership sheets/feed/turn order, and backend/frontend tests.
- Gaps at baseline: no explicit D&D ruleset record, combat card, D&D roll event/audience model, canonical temp HP/death saves/spell slots, standard condition picker, D&D reference view, or linked character health on tokens.
- Authentication prerequisite is shipped in the baseline. Every Release 1 API derives campaign/role/character from the authenticated server session; request IDs and character IDs convey no authority.
- Existing campaigns retain their `game_system`. D&D profiles are created lazily only for characters in a D&D campaign and are pinned to `dnd_2024`. Mothership rows are not reclassified or rewritten.
- Canonical character health is `character.hp`/`character.max_hp` plus `dnd_character.temp_hp`; tokens store only `character_id`. Spell slots, features, death saves, Inspiration, concentration, exhaustion, and custom pools live in that same `dnd_character` row.
- Grid distance remains the existing Euclidean rule with scene `units_per_square` (default 5 ft). This release does not change movement adjudication.
- Release 3 fog will be visual exploration fog, not secure pixel redaction. Hidden tokens and private data remain server-filtered independently.
- Persistent locations remain the configured companion SQLite database and `companion-assets/<campaign-id>/`. Back up the database (including WAL/SHM while applicable) and assets together while the bot is stopped; restore them together.

## Authorization matrix

| Record/action | DM | Owning player | Other player |
| --- | --- | --- | --- |
| D&D combat card read/edit | all / all | own / own | none |
| Exact linked-token HP | all | own | omitted |
| Public roll | read/create for controlled card | read/create own | read |
| Private player roll | read | read/create own | omitted |
| DM-only roll | read/create | omitted | omitted |
| Token appearance/conditions | all | owned, unlocked token | denied |
| Character/token link | all | denied | denied |

Generic NPC tokens continue to use independent counters. Hidden tokens, private counters, and private roll events are filtered before serialization.

## API and schema contracts

- `GET /api/dashboard` adds `dnd_characters` and filtered `dnd_rolls` for D&D campaigns only.
- `PATCH /api/dnd/characters/{id}` uses optimistic `revision` and updates the canonical D&D profile/HP.
- `POST /api/dnd/characters/{id}/resources` requires `operation_id` and applies an atomic bounded delta.
- `POST /api/dnd/characters/{id}/rolls` requires `operation_id`; expressions are limited to one term, at most 50 dice, d2–d1000, and a ±1000 modifier.
- `dnd_character`, `dnd_roll_event`, and `dnd_request` are additive tables. SQLite schema creation is idempotent and foreign-key scoped to existing campaign characters.

## Phase estimates after audit

P1A and P1B were implemented as the first Release 1 slice. Remaining estimates are intentionally deferred until C2 is exercised with multiple real browser sessions: P2A 3–5 reviewable changes, P2B 3–5, P3A 4–6, P3B 3–5.

## Release gates and manual evidence

Automated checks cover migration, ownership, cross-campaign rejection, expression limits, d20 selection, audience filtering, Inspiration linkage/consumption, idempotent resources, and linked-token HP filtering. Before declaring a deployed Release 1 rehearsal complete, run one DM and five authenticated player sessions and record refresh/reconnect/process-restart behavior. The UI labels rules automation boundaries; the app does not decide hits, save outcomes, concentration outcomes, damage typing, feature legality, or recovery.

Mothership regression gate: run the full backend suite and frontend test/build. Confirm a Mothership dashboard contains no D&D payload and its sheet, d100 checks, inventory, feed, turn order, and minimap still render.
