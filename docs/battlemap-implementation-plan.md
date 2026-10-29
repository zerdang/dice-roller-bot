# Battlemap implementation plan

Status: in progress on `feature/battlemap` (stacked on `feature/current-development`).

## Source audit and assumptions

- `main`/`develop` end at the legacy dice bot commit; the React companion and HTTP API are on
  `feature/current-development`. This branch therefore temporarily targets that companion branch. After review,
  PR #1 brings the companion baseline to `main`, then this branch can be retargeted to `main` without rewriting it.
- The current app is React 19/Vite, `aiohttp`, and a single SQLite companion database. Bearer links resolve to a
  Warden campaign or one player identity. The browser polls `/api/dashboard` every 2.5 seconds.
- Existing Mothership sheets, rolls, inventory, turn order, themes, and fixed minimap remain usable. D&D gets a
  separate workspace and does not render Mothership mechanics.
- A game selector is navigation only. An authorized campaign's immutable `game_system` wins over a saved browser
  preference. Generic/no-credential entry defaults to D&D.

## Architecture decisions

- **Game modules:** a small frontend registry declares `dnd` and `mothership`, their labels, routes, and capabilities.
  The shell selects a module; authenticated links are pinned to the campaign system. The database adds an immutable
  `campaign.game_system`, backfills legacy rows to `mothership`, and changes uniqueness to `(guild_id, game_system)`.
  Discord setup/invite/link commands accept an explicit game where needed; legacy resolution remains Mothership.
- **Rendering:** React + SVG, with no new runtime dependency. SVG provides accessible objects, deterministic layers,
  pointer hit testing, and world-coordinate geometry. A single transform group applies local pan/zoom. This is more
  maintainable for the expected 50 tokens/30 annotations than a custom canvas accessibility layer.
- **Synchronization:** authorized snapshot polling at 750 ms plus revisioned entity mutations. WebSockets/SSE would
  improve preview latency but add connection state to the existing small aiohttp service. Dragging is local and only
  commits on release. Stale same-entity revisions return conflict; different entities commit independently. Operation
  IDs make retries idempotent. Counter deltas are atomic SQL transactions.
- **Storage:** normalized `map_scene`, `map_asset`, `map_token`, `map_annotation`, `map_preset`, and bounded
  `map_operation` tables in the existing database. World positions are image pixels; token size is square-grid units.
  Assets live under `databases/companion-assets/<campaign-id>/` using opaque IDs. PNG/JPEG/WebP are inspected server
  side, limited to 20 MiB, 12,000 px/axis, and 80 million decoded pixels. Asset responses require bearer auth and
  campaign/active-scene authorization.
- **Visibility and permissions:** every query is constrained by authenticated `campaign_id`. Players receive only the
  active scene, non-hidden objects, and public counters/tags. Token writes require ownership and no lock; annotations
  require creator ownership and no lock. Wardens may manage all objects and preview inactive scenes.
- **Undo:** the latest 20 actor operations are recorded as before/after entity documents. Undo is an authorized inverse
  mutation and succeeds only when the entity revision still equals the operation's resulting revision.
- **Pings/rulers:** rulers are local; shared pings are an in-memory, three-second channel and never enter SQLite.
- **Migration/backup:** migrations are additive except for rebuilding the campaign table to remove the legacy
  `guild_id UNIQUE` constraint. It is performed transactionally with existing IDs preserved. Back up the companion DB
  (including WAL/SHM while stopped) and the asset directory together.

## API contracts

- `GET /api/games` — implemented registry and default.
- `GET/POST /api/battlemap/scenes`, `PATCH/DELETE /api/battlemap/scenes/{id}` — scene management/activation.
- `POST /api/battlemap/assets`, `GET /api/battlemap/assets/{id}` — validated upload and authorized bytes.
- `GET /api/battlemap/state?scene_id=` — filtered snapshot and scene revision.
- `POST/PATCH/DELETE /api/battlemap/tokens[/id]` — revisioned token mutations.
- `POST /api/battlemap/tokens/{id}/counters/{key}/delta` — atomic bounded counter delta.
- `POST/PATCH/DELETE /api/battlemap/annotations[/id]` — markers and circle/cone/line/rectangle effects.
- `GET/POST/PATCH/DELETE /api/battlemap/presets[/id]` — campaign presets.
- `POST /api/battlemap/undo` and `GET/POST /api/battlemap/pings` — scoped inverse and ephemeral pings.

Errors use 400 validation, 401 authentication, 403 authorization, 404 filtered/nonexistent, and 409 stale revision.

## Milestones and acceptance checks

1. Game separation: legacy backfill, dual-game same guild, D&D default registry, explicit-link precedence, and UI
   isolation tests.
2. Scenes/assets/grid: two independent scenes survive reopen/restart; player inactive-scene and cross-campaign reads
   fail; malformed/oversized images fail.
3. Tokens/sync: two players can move only owned unlocked tokens; hidden data is absent; stale same-token update fails;
   independent updates and idempotent retries survive.
4. Counters/tags/presets: atomic simultaneous deltas, bounds, persistence, and private-field filtering.
5. Shapes/markers/pings/ruler: world geometry is stable through transforms; creator/lock rules hold; pings expire and
   are not persisted.
6. Undo/accessibility/integration: conflict-safe inverse, keyboard position editing, turn-order link, all themes, legacy
   regression, production build, restart and multi-client rehearsal.
7. Delivery: GitHub Actions runs Python tests, locked frontend tests/build, and emits a secret/data-free SHA artifact.
   Automated deployment remains intentionally unconfigured until a real target and credentials exist.

## Verification record

Baseline before battlemap edits: 27 Python tests and 14 frontend tests passed on the companion branch.

Current results:

- 51 Python tests pass, including legacy migration, dual-game campaigns, inactive scene/asset isolation, token
  ownership, hidden/private filtering, stale writes, retry-safe scene/preset/asset/object mutations, upload validation,
  world geometry, create/update/delete undo, a paired backup, standalone HTTP authorization, and restart persistence.
- 18 frontend tests pass, including coordinate transforms, pointer-centered zoom, offset snapping, Euclidean distance,
  and all prior Mothership domain tests.
- `npm run build --prefix frontend` succeeds and generated `web/` is current. `git diff --check` passes.
- Two simulated player identities plus a Warden were exercised through the persistence layer. An aiohttp integration
  test recreates the standalone service against the same database. A representative 50-token/30-annotation snapshot
  completes below the one-second test threshold. A real six-browser rehearsal, touch/tablet test, screen-reader pass,
  and measured peer latency run have not yet been performed.
- Implemented UI/API: game selector and isolation, scene create/rename/duplicate/delete/activate, authorized uploads,
  grid controls, pan/zoom/fit, token create/assign/lock/hide/move/delete, counters/tags, shapes/markers, local ruler,
  shared expiring pings, snapshot polling, save/connectivity indication, keyboard selection/movement, and conflict-safe
  undo. Annotations can be selected, dragged, resized/rotated through numeric controls, locked/hidden, and deleted.
  The inspector also exposes portrait upload, optional turn-order links, and preset create/edit/delete/apply.
- `standalone.py`, a multi-stage Docker build, `/healthz`, environment configuration, a one-instance Render Blueprint,
  persistent `/var/data` paths, and paired SQLite/asset backup instructions are implemented. The Discord integration
  reuses the same application factory and the standalone process needs no bot token or Discord connection.

Remaining release verification:

1. Run a real six-browser DM/player rehearsal, including concurrent pointer edits and reconnect behavior.
2. Complete touch/tablet and screen-reader testing; automated coverage does not substitute for these sessions.
3. Build and smoke-test the Docker image. The local Docker Desktop Linux engine was unavailable, so the hosted CI
   container job must provide the reproducible-image result.
4. Inspect the hosted GitHub Actions run for the new commit; local checks cannot prove hosted Actions execution.
5. After review/merge, perform the documented manual Render deployment and persistence/restart smoke check. No paid
   service, secret, repository setting, or live campaign data has been changed by this branch.

Exact next step: push the verified feature commit, inspect hosted CI (including the Docker build), then conduct the
manual multi-browser accessibility rehearsal before merging and deploying from `main`.
