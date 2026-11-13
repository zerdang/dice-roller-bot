# Private reference library setup

The Reference sidebar is available to authenticated D&D players and DMs. It searches a local SQLite catalog; it does not contact GitHub during play. Without a catalog it shows a setup message.

From the repository root, import into the **same database used by the running companion**:

```powershell
python -m scripts.import_5etools --db databases/companion.db
```

If `COMPANION_DB` points elsewhere, supply that exact database path. Back up the application database before operator maintenance. The importer adds versioned reference tables and atomically activates a successful import; it does not modify character or campaign records. Imports may briefly hold a SQLite write lock, so schedule them outside play.

Default pinned upstream commit: `32ef600fab87a585a61dd1a22e9b02dfc58c728a` from [5etools](https://github.com/5etools-mirror-3/5etools-src).

Use `--commit FULL_SHA` to import a reviewed new version. Exact repeat imports return the existing report without reactivating an older version. Existing catalog versions remain stored for pinned references. Import reports include file SHA-256 hashes, record counts, source/edition counts, and inheritance warnings in `reference_version.report`.

Downloads are cached under `databases/reference-cache/COMMIT/`. Both the database and cache are covered by the repository's existing `databases/*` ignore rule. Keep these private runtime files off public static hosting and out of Git. Import separately on each private deployment; the build does not bundle the corpus.

## Coverage and current limitations

- Loads all indexed class and spell files plus backgrounds, species/lineages, feats, optional features, character options, equipment, actions, skills, conditions, languages, and senses. No SRD-only filter.
- Keeps same-named records from different source books separate. Search defaults to all sources and editions.
- Preserves raw source records privately. Expands named variants and straightforward inheritance. Modified inheritance and lineage combinations are explicitly marked for source review; this first milestone does not yet fully interpret those transformations.
- Renders descriptions as escaped plain text and structured mechanical data. Rich linked rendering and automatic build application are subsequent Phase 1 work.
- Only explicit upstream edition markers and known core source mappings receive edition labels; other records show “Edition unspecified.” These are not assumed to be legacy or revised.
- All entries currently have reference-only creation support. The manual builder and character finalizer are not yet implemented.
- Adventure and book bodies, bestiary, and fluff images are not imported.

The DM can choose allowed reference sources from the Reference panel. Restrictions apply to search, detail, and source metadata on the server, including requests for older catalog versions. An empty selection disables all reference entries for that campaign; “Allow all sources” removes the restriction. These controls do not yet represent character-creation policies.

## Development verification

```powershell
python -m scripts.import_5etools --db databases/reference-development.db
python -m pytest tests/test_reference.py -q
```

The development database is a separate validation artifact. It does not populate the running companion unless that companion is configured to use it.
