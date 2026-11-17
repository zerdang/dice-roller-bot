# Release 2 implementation record — P2A

Recorded November 1, 2026 at baseline commit `9f8d090` on `feature/dnd-2024-release-1`.

## Delivered P2A behavior

- The DM scene browser presents authorized map thumbnails, name search, folder filtering, per-identity favorites, and clear live-versus-preview status. Selecting an inactive scene changes only the DM's local `scene_id`; players continue to receive the active scene.
- Scene folders are campaign-scoped, single-parent records. Deleting a folder leaves its scenes unfiled. Existing scenes are migrated additively with a nullable `folder_id`.
- Creature templates are campaign-scoped and DM-only. They store portrait, name, grid size, color, default counters/tags, optional AC/HP, and private manually authored details.
- Button or drag-and-drop placement copies template values into a new token. Template edits and deletion do not mutate existing tokens. AC and HP become independent token counters at placement time.
- Existing asset authorization remains the single download boundary. A player cannot list inactive scenes, folders, or creature templates, and an asset is downloadable only when it is used by the active scene or a visible active-scene token.

## Persistence and migration

The additive SQLite records are `map_scene_folder`, `map_scene_favorite`, and `map_creature_template`; `map_scene.folder_id` is added on store startup when absent. Records remain in the configured companion database. Portraits and maps remain in `companion-assets/<campaign-id>/` and must be backed up with the database.

## Validation

- Backend: `python -m unittest discover -s tests` — 69 passed.
- Frontend: `npm test` — 18 passed.
- Production bundle: `npm run build` — passed and refreshed `web/` assets.
- Focused coverage verifies folder/favorite scope, player denial, inactive-scene privacy, three independent placements, injury to one copy, unchanged template/other copies, and placement after reopening the store.

## C3 review status

Automated P2A behavior is complete. Before marking C3 accepted in a deployed environment, run the PRD's browser scenario with six scenes/two folders and record DM/player network evidence plus an actual process restart. Scene cards currently reuse the authorized, browser-cached source image instead of generating a smaller server-side derivative; the existing 20 MiB, 12,000 px, and 80-megapixel upload limits still apply. A bounded derivative generator is the remaining performance hardening item if real campaign maps make the browser materially heavy.
