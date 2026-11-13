# Character Creation and Player Reference Plan

Status: Phase 1 authorized and in progress. Phase 2 still requires separate initiation.

Implementation checkpoint: the first Phase 1 milestone adds a private pinned importer, versioned search catalog, authenticated search/detail APIs, DM reference-source controls, and a player/DM Reference sidebar. A real-data import produced 8,067 records, including 43 class records, 367 subclasses, 254 species, 139 lineages, and 175 backgrounds (counts include source/edition variants). 343 records carry source-review notices. See [private reference setup](private-reference-setup.md). Automated creation support, linked rich rendering, drafts, portrait handling, and finalization remain Phase 1 work; Phase 1 is not complete.

## Objective

Second Phase 1 milestone implemented: separate owned drafts, autosave with revision conflicts, resume, pinned catalog selection, class/species/background/lineage browsing, standard-array swapping, point buy, recorded rolls reused across an owner's campaign drafts, DM-controlled ability methods, background increases, and class skill choices. Open Character creation drafts from the sidebar. Drafts do not modify live sheets. Finalization remains unavailable while feature choices, languages, equipment, spells, portraits, and final review are unfinished. Validation includes 91 backend tests, 20 frontend tests, production build, and previewing all 472 imported class/species/background records. This milestone does not complete Phase 1.

Create a readable D&D 5.5e / revised 2024 character builder with two interchangeable modes:

- **Manual Build:** compact, searchable selections with explicit ability allocation and control over every required choice, inspired by reference pictures 6–7.
- **Quick Build:** spacious illustrated class, species, and background cards with editable recommendations, inspired by reference pictures 1–4.
- **Shared portraits:** a library and upload picker inspired by picture 5.

Both modes use one draft, one rules evaluator, and one finalization process. A shared reference catalog also lets players search rules during play and open explanations directly from their character sheets.

Delivery has two phases. Phase 1 was initiated after the scope expansion below; review its results before initiating Phase 2.

## Current application and scope

The existing character sheet stores class, species, and background as editable identity fields. It supports manually entered abilities, training, equipment, spells, and features, but those fields do not constitute a character-creation rules engine. Existing map assets include portrait references; map uploads currently require the DM role.

Initial scope:

- Level-1, single-class characters using revised 2024 rules, with explicit handling for legacy and non-core options.
- Maximal reference coverage: every class, subclass, species, subrace/lineage, and background in the pinned 5etools data, without an SRD-only allowlist.
- Distinguish reference availability from automation support. Keep all catalog options browsable; provide a clearly labeled manual/DM-reviewed path when automatic creation is not supported.
- Standard array, point buy, recorded ability rolls, and campaign-permitted manual entry.
- Draft saving, portrait selection, validation, finalization, and sheet integration.
- Player reference search with campaign source filtering.

Later scope: higher-level creation, leveling, multiclassing, existing legacy character conversion, arbitrary homebrew automation, and natural-language AI answers. Legacy catalog access is included now; conversion of existing characters is deferred. Catalog records may describe higher-level features without making them selectable during level-1 creation.

Existing manually maintained characters must remain usable. Importing catalog updates must not rewrite them.

## Rules foundation

The official sequence is class; origin, including background, species, and languages; ability scores; alignment; and remaining details. The UI may group dependent choices into additional steps while preserving those relationships.

- Ability generation supports the standard array of 15, 14, 13, 12, 10, 8; 27-point buy; or six rolls of 4d6 keeping the highest three. Campaign settings determine permitted methods.
- Backgrounds supply eligible ability increases: +2/+1 on two eligible abilities or +1 on each of three, with a maximum of 20 after these increases. They also grant a specified Origin feat, skills, a tool proficiency, and an equipment alternative.
- Species supplies size, speed, and traits, including any required ancestry or lineage selections.
- Class and feature records determine remaining training, equipment, spellcasting, and feature choices.

Verify implementation against [official character creation](https://www.dndbeyond.com/sources/dnd/br-2024/creating-a-character) and [official character origins](https://www.dndbeyond.com/sources/dnd/br-2024/character-origins). Use the [SRD 5.2.1](https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf) as the pinned reusable baseline, extending the repository's existing rules manifest and matrix.

## Data sources and integration approach

Use [5etools source data](https://github.com/5etools-mirror-3/5etools-src/tree/main/data) as an upstream structured catalog through an import adapter. Import a pinned commit into the app's database; player requests must not depend on live GitHub access.

| Upstream data | Application use |
| --- | --- |
| `data/class/` | Classes, subclasses, class features, progression references |
| `data/races.json` | Species and lineage records; present these as Species in the UI |
| `data/backgrounds.json` | Ability adjustments, proficiencies, feats, equipment alternatives |
| `data/feats.json`, `data/optionalfeatures.json`, `data/charcreationoptions.json` | Granted features and dependent selections |
| `data/spells/` | Spell lookup and eligible spell selections |
| `data/items.json`, `data/items-base.json` | Equipment, armor, weapons, inventory references |
| Skills, languages, conditions, actions, senses | Reference lookup and linked explanations |

The inspected data includes source/page metadata, references, edition information on some records, inherited records, and custom formatting tags. Importing it requires conversion and validation, not just copying JSON into the frontend.

Before enabling any record, inventory:

- Stable internal ID, upstream identity, entity type, source book, page, edition, and imported commit.
- Required choices, eligible options, choice counts, prerequisites, grants, and dependencies.
- Searchable text and structured display content, including resolved internal links.
- Content availability, permission/attribution information, and campaign visibility.
- Support status: reference-only, supported for creation, or unsupported with a reason.

Resolve identities using type, source, name, and relevant parent identifiers. Same-named 2014 and 2024 records must remain distinct. Missing edition metadata requires an explicit source mapping, not a guess based on the name.

Deployment intent: private use by the user's gaming group, with no public corpus distribution. Import the full requested catalog without an SRD licensing filter. Keep downloaded source data and the reference database in ignored private storage, outside static web bundles and public Git commits. Preserve provenance and upstream notices. The repository's [MIT license](https://github.com/5etools-mirror-3/5etools-src/blob/main/LICENSE.md) describes software terms; private deployment is not recorded as a blanket rights grant for third-party text or images. Reassess content distribution separately if the deployment scope changes.

The SRD remains a rules-verification baseline, not a catalog ceiling. Report imported counts by entity type, source, and edition, plus unresolved references and unsupported transformations. Do not silently discard records that the importer cannot fully interpret.

## Shared architecture

1. **Import adapter:** reads the pinned upstream snapshot, resolves references/inheritance, validates records, and produces an import report.
2. **Reference catalog:** stores normalized entities, source versions, relationships, and a full-text search index. Evaluate SQLite FTS5 alongside the application's existing SQLite storage.
3. **Rules evaluator:** converts explicit selections into grants, required choices, derived statistics, and validation messages. It remains authoritative on the server.
4. **Character draft:** stores choices, original ability values, recorded roll assignments, portrait, campaign policy version, and rules version independently of finalized sheet data.
5. **Creation UI:** Manual and Quick views edit the same draft and consume the same validation and preview results.
6. **Finalizer:** validates and atomically creates the owned character and populated sheet, with retry protection.

Keep reference reading separate from automated rule application. A readable feature is not automatically supported for character creation. Avoid deriving executable effects from prose at runtime.

Track the source of every grant. If two selections grant the same benefit, removing one must not remove the other. Keep user overrides distinct from derived values. Upstream updates should create a new catalog version; existing characters stay pinned until deliberately migrated.

## Phase 1 — Reference foundation and complete Manual Build

Implement in the following order.

### 1. Inventory sources and define campaign policies

- Produce a source/coverage manifest and identify a reviewed upstream commit. Catalog import covers all classes, species, and backgrounds, including legacy and non-core sources.
- Inventory all level-1 choice dependencies for the twelve classes and enabled origins.
- Define campaign-approved sources, ability-generation methods, roll/reroll policy, manual overrides, and whether DM review is required.
- Distinguish revised content, legacy content, and source-unspecified material. Default reference search to all sources/editions; allow players to filter and DMs to restrict campaign sources. Creation defaults to revised rules, with explicit manual review for unsupported combinations.

Deliverable: every launch option has a source, supported behavior, and complete dependency checklist.

### 2. Implement import, normalization, and reference search

- Resolve inherited records and cross-references with cycle and missing-reference checks.
- Translate supported formatting tags into sanitized display components and plain search text. Report unknown constructs rather than silently dropping them.
- Preserve source/page references and revision identity.
- Import into staging, validate, and activate a complete catalog version atomically. Failed imports leave the current catalog available.
- Add authenticated search/detail endpoints with pagination and campaign filters enforced server-side.
- Add a Reference sidebar with search, category/source/edition filters, and readable entry details.
- Keep adventure text and DM-only material outside the player index and responses. Exclude these categories from the initial import.
- Add context links from sheet spells, features, and conditions. Opening a reference must preserve sheet/draft state and restore keyboard focus on return.

Deliverable: players can quickly find an allowed entry and follow its related references without leaving the table.

### 3. Implement drafts and rules evaluation

- Add ownership-aware draft persistence, autosave status, resume, and revision/conflict handling.
- Separate base ability scores, background adjustments, final scores, and overrides.
- Implement point-buy costs, array allocation, recorded rolls, and campaign-authorized direct entry.
- Generate ability rolls on the server, store individual dice and discarded dice, and reuse results on retries or refresh. Apply the campaign's reroll policy.
- Model automatic grants and limited selections, including skill overlap, expertise eligibility, species choices, Origin-feat choices, class features, and spells.
- Validate applicable equipment, starting money, and purchases.
- Calculate supported derived sheet values, including HP, proficiency, saves, skills, initiative, armor class, attack values, and spellcasting values using their actual feature/equipment rules.
- Recompute affected choices when a parent selection changes. Preserve valid user selections and explain those requiring replacement.

Deliverable: the server can preview and validate a complete level-1 build independently of the UI.

### 4. Build the manual creation interface

Suggested steps:

`Class → Origin → Abilities → Skills & Features → Equipment & Spells → Identity → Review`

- Use searchable lists and expandable detail sections, inspired by pictures 6–7.
- Keep required choices prominent, with counters such as “Choose 2 skills: 1 selected.”
- Show granted proficiencies with their source, and explain disabled options.
- Present base score, background increase, total, and modifier in the abilities editor.
- Provide dropdown/swap controls for allocation; dragging may be an enhancement but never a requirement.
- Show point-buy costs and remaining points. Display stored roll results when using rolled abilities.
- Show only spell and feature steps applicable to the current build.
- Allow returning to earlier steps and saving incomplete drafts.
- Show a completion checklist with links to unresolved fields. Explain why finalization is unavailable.

Deliverable: every supported choice can be completed without editing raw sheet fields.

### 5. Add identity, portraits, and finalization

- Provide name, alignment, optional appearance/personality/history, and optional portrait.
- Build Library and Upload portrait tabs with optional species filters, cropping, replacement, removal, and sheet/token previews.
- Add character-owned portrait permissions; reuse suitable asset infrastructure without enabling player map uploads.
- Validate image type, decoded dimensions, and size; store an asset reference and crop settings.
- Finalize only after server validation, creating the character and initial sheet atomically with an idempotency key.
- Connect the resulting character to the existing roster, sheet, and roll workflows. Respect campaign DM-review policy where enabled.

Deliverable: a saved character is immediately usable at the table.

### Phase 1 acceptance criteria

- Every enabled core class can produce a valid level-1 character with all required dependent choices resolved.
- Reference-only or unsupported options remain discoverable and must disclose required manual review; they cannot silently produce automatically validated characters.
- Ability budgets, assignments, grants, spell choices, and equipment totals are checked on the server.
- Refresh/resume preserves the draft and roll history; repeated finalization produces one character.
- Changing class/background/species removes only obsolete contributions and identifies invalidated choices.
- Players can access only authorized drafts, portraits, and reference content; DM-only fields remain private.
- Existing manually maintained characters remain functional.
- A player completes creation and the DM verifies the resulting sheet in separate sessions.

Stop after Phase 1 for review and manual authorization to begin Phase 2.

## Phase 2 — Visual Quick Build and editable recommendations

### 1. Build the visual selection experience

- Use picture 1's Class, Species, and Background overview with a smaller identity/portrait area.
- Use pictures 2–4's searchable card galleries with separate Details and Select actions.
- Show short original descriptions, useful mechanical highlights, source labels, and selected states.
- Background cards expose eligible ability increases, granted skills, and feat alongside their narrative.
- Share the portrait picker from Phase 1.
- Make card density respond to available width; retain readable descriptions and comfortable controls.

### 2. Add reviewed recommendation profiles

- Define legal, reviewed starting profiles for each enabled class and relevant play-style alternatives.
- Recommend abilities, skills, equipment, spells, languages, and feature choices against the actual selected origin and campaign policy.
- Label automatic choices and explain their purpose briefly.
- Use the campaign's permitted ability method; default to standard array when allowed.
- Keep choice randomization separate from ability rolling. Lock selected class/origin/portrait fields before randomizing the remainder.
- Route generated selections through the same evaluator as Manual Build. Surface unresolved choices when a supported recommendation is unavailable.

### 3. Add review and seamless mode switching

- Present the complete proposed build before finalization, with Edit links for every recommendation.
- Provide “Customize in Manual Build” and a return to the Quick overview.
- Switching modes preserves explicit selections, portrait, ability rolls, and draft identity.
- Returning to Quick Build must not automatically replace manual choices. Regenerating recommendations requires an explicit action and a preview of affected selections.
- Finalize through the Phase 1 transaction and permission checks.

### Phase 2 acceptance criteria

- Quick Build creates valid characters through the same rules and finalizer as Manual Build.
- Every enabled class has a reviewed recommendation profile and tested origin interactions.
- Locked choices survive randomization; ability-roll policy still applies.
- Players can inspect and edit every automatic choice before creation.
- Repeated mode switching and refresh preserve the same draft and recorded rolls.
- A new player can create a character using recommendations, while an experienced player can customize the same draft without starting over.

## Readability and verification requirements for both phases

- Use available component width for responsive layout. Show a side summary only when both it and the form remain readable; otherwise collapse it into an expandable summary.
- Preserve full skill/feature names, visible labels, readable body text, and comfortable touch targets. Expand content instead of shrinking text to fit.
- Keep one primary scroll surface and ensure navigation/actions do not obscure fields.
- Verify keyboard selection, focus handling, screen-reader names, 200% zoom, and desktop/tablet/narrow-phone layouts.
- Test martial, spellcasting, and choice-heavy builds, duplicate proficiencies, extra feats, species branches, and parent-choice changes.
- Test malformed imports, missing references, duplicate names across editions, source exclusions, and catalog rollback/version pinning.
- Test unauthorized access, stale drafts, network retries, failed uploads, and repeated finalization.
- Test reference search with exact names, partial names, and category filters against the launch catalog; agree on a performance target using the deployment environment.
- Perform browser-based layout and interaction checks with realistic content. Unit tests and successful builds alone do not establish usability.

## Review checkpoints

Phase 1 scope is now authorized: maximal upstream catalog coverage for private use, level-1 creation, and revised rules as the default. Keep campaign policy controls and explicit manual review for combinations outside automated support.

At the Phase 1 review, demonstrate reference search and complete manual creation with both player and DM sessions. At the Phase 2 review, demonstrate a recommended quick build, manual customization, mode switching, and the final playable sheet.

Phase 1 implementation begins with the pinned private catalog import, coverage reporting, authenticated reference endpoints, and player/DM reference sidebar. Drafts, rules evaluation, manual creation, portraits, and finalization follow in Phase 1. Phase 2 remains pending.

Current Phase 1 progress: the private catalog, reference browser, owned drafts, ability and skill validation, level-one class feature listing, and class/background starting equipment package selection are implemented. Spells can now be selected from the versioned catalog; their level, availability, and class progression counts are checked, while class-list eligibility and origin grants still need DM review. Feature, feat, and language decisions can be recorded for review; structured rule validation for those decisions is pending. Portraits, safe finalization into a live sheet, and browser layout verification remain to be completed before Phase 1 review.
