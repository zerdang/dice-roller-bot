# dice-roller-bot

[![Discord Bots](https://top.gg/api/widget/servers/809017610111942686.svg)](https://top.gg/bot/809017610111942686)

## Installation and run
Few simple steps for bot installation:
1. Clone this repository
```console
git clone git@github.com:kreicer/dice-roller-bot.git
```
2. Go to repository directory
```console
cd dice-roller-bot
```
3. Install python requirements
```console
pip install -r requirements.txt
```
4. Create config file in repository directory
```console
touch config
```
5. Register and create app in [Discord developers portal](https://discord.com/developers/applications/)
6. Add the bot token, command prefix, database paths, and optional integrations
   to the extensionless `config` file
```console
[bot]
name = <bot_name>
version = <bot_version>
token = <token_here>
shards = <number_of_shards_here>
prefix = <prefix_here>

[developer]
name = <developer>
link = https://discordapp.com/users/<your_discord_user_id>
github_link = <github_link>

[community]
policy = <privacy_policy_doc_link>
support = http://discord.gg/<invite_code>

[topgg]
enable = <True_or_False>
link = <topgg_link>
token = <topgg_token_here>

[metrics]
enable = <True_or_False>
port = <port_number>
python_ext = <True_or_False>

[db]
jokes = databases/<jokes_db_name>.db
admin = databases/<admin_db_name>.db
user = databases/<user_db_name>.db
companion = databases/companion.db

[dir]
feedback = <feedback_directory>
jokes = <jokes_directory>

[log]
file = <log_file_name>.log

[companion]
enable = True
host = 127.0.0.1
port = 8080
public_url = https://your-public-companion-url.example
```
7. Run bot
```console
python bot.py
```

## Usage
Use help command or tag bot to list all available commands.

## Tabletop companion

The tabletop companion is a responsive React interface served by the Python bot.
It shares Discord dice rolls while keeping campaign sheets and inventory in a
local SQLite database. The interface includes retro CRT, low-glare Simple, and
medieval-fantasy display themes, and provides different player and warden views.

### Feature inventory

| Area | Current capabilities |
| --- | --- |
| Discord dice | General-purpose `/roll` expressions, modifiers, dice pools, keep/drop, rerolls, exploding dice, counting modes, shortcuts, autocomplete, and campaign telemetry relay. |
| Campaign access | One campaign per Discord server, Discord-owner-controlled setup, rotating Warden links, rotating per-player links, hashed bearer credentials, and separate player/Warden authorization. |
| Character records | Character name and class, Health, current/maximum Wounds, Stress, compact Resolve, eight Mothership Stats/Saves, public crew notes, and Warden-only notes. |
| Mothership checks | Server-generated d100 roll-under checks, Trained/Expert/Master skill bonuses, Advantage/Disadvantage, doubles as criticals, failed-check Stress, d20 Panic Checks after critical failures, and Stat/Save loss for Stress gained above 20. |
| Skills | Three-tier prerequisite tree, class-granted skills, persistent selections, keyboard navigation, and contextual descriptions. |
| Equipment | Weapon and armor slots, carried-equipment catalog, persisted item ordering and counters, d10 weapon damage rolls, and equipment detail tooltips. |
| Warden oversight | Individual crew cards plus consolidated Stats + Skills and Equipment matrices. |
| Event telemetry | Shared live feed containing browser checks, damage rolls, Panic results, and Discord `/roll` output. |
| Turn order | Shared ordered crew/enemy list in the far-right column; Warden-only drag-and-drop ordering and enemy creation/removal. |
| Minimap | Blank player CRT map, room-by-room Warden reveals, automatic corridors between two revealed adjacent rooms, independently controlled dotted side routes, and labeled Warden hover/click hotspots. |
| Display and accessibility | CRT, Simple, and Fantasy themes; adjustable CRT strength; remembered browser preferences; reduced-motion behavior; keyboard-focusable controls. |
| Local operations | Automatic companion schema upgrades, guarded companion-only database reset, production frontend build, local web serving, and optional temporary Cloudflare tunnel startup. |

### Windows quick start

The recommended entrypoint is `start_win.bat`, located one directory above this
repository. From this directory, run:

```powershell
..\start_win.bat
```

The launcher:

1. Checks Python, Node, npm, Cloudflare Tunnel, and the companion configuration.
2. Installs locked frontend packages when `node_modules` is missing.
3. Builds the React source into `web/`.
4. Starts a temporary Cloudflare Quick Tunnel to `http://127.0.0.1:8080`.
5. Writes that session's public URL to `config` and starts `bot.py`.
6. Stops the tunnel when the bot exits.

The `trycloudflare.com` address changes each time the launcher starts. Generate
new player and warden links after each restart. To validate the launcher without
starting anything, run `..\start_win.bat --check`.

For local-only operation without Cloudflare, run:

```powershell
.\.venv\Scripts\python.exe .\bot.py
```

The local browser entrypoint is `http://127.0.0.1:8080`. Friends outside the
computer cannot reach that local address without a tunnel or another deployment.

### User entrypoints

Run these slash commands in the Discord server containing the campaign:

| Command | Who can use it | Result |
| --- | --- | --- |
| `/tabletop setup name:<campaign>` | Server administrator; if a campaign already has an owner, the caller must also be that owner | Creates or renames the campaign and records the caller's Discord ID as its owner. It does not return a warden URL. |
| `/tabletop warden-link` | Campaign owner only | Rotates the warden credential and privately returns a new management URL. The old URL stops working. |
| `/tabletop invite player:@member` | Campaign owner only | Creates or rotates the selected member's player URL and returns it privately to the warden. |
| `/tabletop link` | Any server member | Creates or rotates that member's own player URL and returns it privately. |

For `/tabletop invite`, select the Discord member in the `player` field—for
example, `/tabletop invite player:@Alex`—then send the returned URL to that
person in a DM.

If a campaign was created before ownership support was added, its intended
warden should run `/tabletop setup` once with the campaign name. This claims the
campaign and revokes the old warden link. Then run `/tabletop warden-link`.

### Browser UI

Use the **Display** selector in the top system bar to switch visual themes. The
preference is remembered by that browser. Simple removes scanlines, glow,
clipped corners, and decorative backgrounds in favor of off-white text,
low-glare charcoal panels, plain borders, and restrained player/warden accents.
Fantasy uses aged parchment, ink-dark text, oxblood and antique-gold accents,
serif typography, ornamental borders, and warmer equipment art. CRT provides a
persistent 0–100% effect slider in the system bar.

The top-level browser screen contains:

- **Personnel file:** one character in player view. Warden view provides Crew
  Cards, Stats + Skills, and Equipment tabs; Crew Cards includes a selector for
  opening one character at a time.
- **Resource tracks:** Stress uses a fixed 2–20 range and begins filled to its
  minimum of 2. Wounds track editable current/maximum values, begin at 0/2,
  add one maximum Wound for Marines and Androids, and display a Death Save
  warning at the maximum. Health stores an editable current value and
  character-specific maximum. Resolve is a smaller 0–5 special counter beside
  character identity. Every resource includes direct numeric editing and quick
  decrement/increment controls.
- **Personnel metrics:** fixed Mothership attributes Strength, Speed, Intellect,
  Combat, Sanity, Fear, Body, and Armor. Each 0–99 value is shown as a filled
  circular gauge. Select the pencil to edit values. Desktop uses four paired
  rows with Stats on the left and Saves on the right. Select any gauge outside
  edit mode to make a server-generated d100 roll-under check. The result appears
  below the metrics and is added to Event Telemetry. Checks support applicable
  Trained/Expert/Master bonuses and Advantage or Disadvantage. Failures add 1
  Stress, doubles resolve as criticals, critical failures immediately make the
  required d20 Panic Check, and Stress gained above 20 reduces the checked
  Stat or Save instead.
- **Class assignment:** the dropdown beside the crew member's name offers
  Teamster, Android, Scientist, and Marine. A selection applies the class stat
  bonus and replaces the live saves with that class's four starting saves.
  Starting values remain labeled beneath live saves in muted grey. Changing
  class removes the previous class bonus before applying the new one, so bonuses
  do not stack.
- **Crew Log tab:** player-visible character notes live beside Skills and
  Inventory in the tabbed record workspace. The same tab adds a separate
  Command Eyes Only field in warden view.
- **Skills:** the Loadout Manifest opens on a selectable three-tier Mothership
  skill tree: Trained (+10), Expert (+15), and Master (+20). Advanced skills
  require a connected prerequisite, class skills are marked automatically, and
  selections persist per character. Every advanced node displays its eligible
  prerequisite names and is connected to them by square, orthogonal tree lines.
  The fixed three-column tree scrolls vertically; hover or keyboard-focus a
  skill for a plain-language description.
- **Loadout manifest:** two fixed illustrated slots select one of the seven
  combat guns and one armor item from the supplied catalogs. The weapon slot
  displays the selected gun's d10 damage pool and can make a server-generated
  damage roll; individual dice and the total appear in the slot and shared Event
  Telemetry. The tranquilizer pistol uses its Body-save effect instead of a
  normal damage roll. Beneath the slots, a catalog menu adds carried
  miscellaneous equipment. Every choice persists with its table cost and
  description. Hover over—or keyboard-focus—a carried item to open its
  informational tooltip, and use its remove control to take it off the character.
- **Event telemetry:** the latest Discord rolls recorded for the campaign.
- **Minimap:** a fourth Loadout Manifest tab begins as a blank CRT panel for
  players. Only specifically revealed room pixels are composited into it, so
  hidden hallways and the overall facility structure cannot be inferred. The
  corridor between two adjacent rooms appears automatically once both rooms
  have been revealed, producing a continuous discovered route without exposing
  an unknown destination. The two dotted vent/service paths remain independent
  Warden reveals and are never generated automatically. In Warden view, room
  hotspots display a labeled outline on hover or keyboard focus and can be
  clicked directly to toggle player visibility.
- **Turn order:** a live third column to the right of Event Telemetry lists all
  crew and enemies. Only the Warden can drag entries into a new order, add
  enemies, or remove enemy entries.
- **Warden matrices:** Stats + Skills places crew names down the left and all
  eight metrics across the table, followed by hoverable selected-skill labels.
  Equipment places crew names down the left with Weapon, Armor, and Other
  Equipment columns. Every listed skill and item exposes its description on
  hover or keyboard focus.

| Capability | Player URL | Warden URL |
| --- | --- | --- |
| Characters visible | Signed-in player's character | Every campaign character |
| Edit HP, metrics, public notes, and inventory | Own character | Every character |
| View and edit command notes | No | Yes |
| View campaign roll feed | Yes | Yes |
| View shared turn order | Yes | Yes |
| Reorder turns and manage enemies | No | Yes |
| View revealed minimap regions | Yes | Yes, with reveal controls |

Changes are saved automatically when a field loses focus or immediately when a
quick control is used. Inventory edit forms use an explicit **Save** button.

### Authentication and link safety

Private URLs contain a random credential after `#token=`. The browser stores
that credential in local storage and removes it from the visible address after
opening the app. Select **Exit** in the interface to clear the stored credential.

Discord command access for warden operations is tied to the campaign owner's
Discord user ID. The browser URL itself is a bearer credential, not a Discord
login: anyone who receives a forwarded URL can use it. Keep warden URLs private
and run `/tabletop warden-link` to revoke a URL and issue a replacement. Use
HTTPS for every public deployment.

### Persistence and local reset

Companion data is stored in the `[db] companion` path, which defaults to
`databases/companion.db`. It contains campaigns, ownership, characters,
Health/Wounds/Stress/Resolve, stats, notes, inventory, access-token hashes, and
the companion roll feed. Schema
updates run automatically without removing existing records.

To permanently erase only this local companion data, first stop the bot and run:

```powershell
.\wipe_local_database.bat
```

The reset utility displays the resolved database path and requires typing
`WIPE`. It also removes that database's SQLite `-wal` and `-shm` sidecars. It
does not change Discord and does not touch the jokes, admin, or user databases.
The companion database is recreated empty on the next startup.

### Application entrypoints

| Path | Purpose |
| --- | --- |
| `../start_win.bat` | Windows production launcher, React builder, and temporary Cloudflare tunnel manager. |
| `bot.py` | Python process entrypoint; loads Discord cogs, synchronizes slash commands, and connects the bot. |
| `cogs/companion.py` | `/tabletop` Discord commands, bearer authentication, static web hosting, and companion HTTP API routes. |
| `functions/companion.py` | SQLite schema, migrations, campaign ownership, authorization, and persistence operations. |
| `frontend/src/main.jsx` | React browser entrypoint. |
| `frontend/src/App.jsx` | Companion screens and interactive UI components. |
| `frontend/src/equipment.js` | Static weapon, armor, and equipment catalog transcribed from the supplied tables. |
| `frontend/src/skills.js` | Mothership skill tiers, bonuses, prerequisites, and class-skill lookup data. |
| `frontend/src/classes.js` | Class starting Saves, Stat bonuses, and class feature descriptions. |
| `frontend/src/app.css` | CRT, Simple, and Fantasy visual systems plus responsive layouts. |
| `frontend/public/images/` | Source PNG graphics used by the weapon, armor, and minimap views. |
| `web/index.html` | Generated production web entrypoint served by the bot. Do not edit generated assets directly. |
| `wipe_local_database.bat` | Guarded Windows entrypoint for local companion data deletion. |
| `wipe_local_database.py` | Config-aware reset implementation used by the batch file. |
| `tests/test_companion.py` | Companion persistence, authorization, Mothership roll, turn-order, map-state, and migration tests. |

### Capability entrypoint map

This table shows where to begin when changing a specific behavior. Browser
components live in `frontend/src/App.jsx`; persistence methods live in
`functions/companion.py`; HTTP and Discord routing lives in
`cogs/companion.py` unless another path is named explicitly.

| Capability | User/UI entrypoint | Server entrypoint | Persistent storage or output |
| --- | --- | --- | --- |
| Start the complete Windows stack | `../start_win.bat` | `bot.py` and the Cloudflare Quick Tunnel process | Rebuilds `web/`; updates the session public URL in `config`. |
| Run locally without a tunnel | `http://127.0.0.1:8080` | `bot.py` → `Companion.cog_load()` | Existing local SQLite files. |
| General Discord dice | `/roll` | `cogs/roll.py` → `Roll._roll()` | User/server statistics plus `roll_event` when a campaign exists. |
| Create or rename a campaign | `/tabletop setup` | `Companion.setup_campaign()` → `CompanionStore.create_campaign()` | `campaign`. |
| Issue Warden access | `/tabletop warden-link` | `Companion.warden_link()` → `rotate_warden_token()` | `campaign.warden_token_hash`. |
| Issue player access | `/tabletop invite` or `/tabletop link` | `invite_player()` / `player_link()` → `create_or_rotate_player()` | `character.player_token_hash`. |
| Authenticate browser requests | Private `#token=...` URL | `Companion.auth()` → `CompanionStore.authorize()` | Browser `localStorage`; only a token hash is stored in SQLite. |
| Load the browser workspace | `App` | `GET /api/dashboard` → `dashboard()` | Read-only aggregate of campaign tables. |
| Edit character identity/resources | `CharacterCard` and `ResourceBar` | `PATCH /api/characters/{id}` → `update_character()` | `character`. |
| Edit Stats/Saves and make checks | `StatsPanel` | `PATCH /api/characters/{id}` and `POST /api/characters/{id}/rolls` → `roll_character_stat()` | `character.stats_json`, `character.stress`, and `roll_event`. |
| Select skills | `SkillsPanel` | `PATCH /api/characters/{id}` → `update_character()` | `character.skills_json`. |
| Manage loadout | `Inventory` and `LoadoutSlot` | Character-item POST/PATCH/DELETE/order routes | `inventory_item`. |
| Roll weapon damage | `LoadoutSlot` | `POST /api/characters/{id}/damage-rolls` → `roll_weapon_damage()` | `roll_event`. |
| Read shared telemetry | `RollFeed` | `GET /api/dashboard` | Latest 50 rows from `roll_event`. |
| Review all crew | `WardenWorkspace`, `WardenStatsMatrix`, and `WardenEquipmentMatrix` | `GET /api/dashboard` | Read-only character/inventory aggregation. |
| View or manage turn order | `TurnOrder` | `/api/turn-order` routes → `add_enemy()`, `delete_enemy()`, and `reorder_turns()` | `turn_entry`; missing crew entries are enrolled automatically. |
| View or reveal the minimap | `Minimap` | `PATCH /api/map-visibility` → `update_map_visibility()` | `campaign.map_visibility_json`; map pixels come from `frontend/public/images/map.png`. |
| Generate discovered hallways | `Minimap` and `MAP_HALLWAYS` | No separate route; derived in the browser from room visibility | No additional state: a corridor appears when both endpoint rooms are visible. |
| Change display theme | Top-bar Display/CRT controls in `App` | No server call | Browser `localStorage`. |
| Reset tabletop data | `wipe_local_database.bat` | `wipe_local_database.py` | Deletes only `companion.db` and its `-wal`/`-shm` sidecars. |
| Upgrade companion schema | Bot startup | `CompanionStore.__init__()` and `_migrate_*()` | In-place `companion.db` schema additions. |
| Upgrade original bot databases | `python migrate.py` | Yoyo migrations under `migrations/server` and `migrations/user` | `server.db` and `user.db`. |
| Build production frontend | `npm run build` from `frontend/` | Vite configuration in `frontend/vite.config.js` | Generated `web/index.html`, `web/assets/`, and `web/images/`. |

### HTTP entrypoints

These routes are internal to the browser client. Every `/api` request requires
the private player or warden bearer credential.

| Method and path | Purpose |
| --- | --- |
| `GET /` | Serve the compiled React application. |
| `GET /assets/*` | Serve compiled JavaScript and CSS. |
| `GET /images/*` | Serve the loadout and minimap PNG assets. |
| `GET /api/dashboard` | Load the authorized campaign, character records, inventory, roll feed, turn order, and map state. |
| `PATCH /api/characters/{id}` | Save character fields, fixed personnel metrics, and selected skills. |
| `POST /api/characters/{id}/rolls` | Generate, resolve, and record a d100 check against a saved Stat or Save. |
| `POST /api/characters/{id}/damage-rolls` | Roll the selected inventory weapon's validated d10 damage pool and record it in Event Telemetry. |
| `POST /api/turn-order/enemies` | Add a Warden-controlled enemy to turn order. |
| `PATCH /api/turn-order` | Persist Warden drag-and-drop turn ordering. |
| `DELETE /api/turn-order/enemies/{id}` | Remove an enemy from turn order. |
| `PATCH /api/map-visibility` | Persist Warden-controlled room and side-path visibility. |
| `POST /api/characters/{id}/items` | Add an inventory record. |
| `PATCH /api/characters/{id}/items/order` | Persist manual inventory ordering. |
| `PATCH /api/items/{id}` | Edit an item or update its quick counters. |
| `DELETE /api/items/{id}` | Delete an inventory record. |

### Companion frontend development

The companion interface is a React application built with Vite. The Python
server serves the compiled output from `web/`; Node is not required while the
bot is running. To install frontend dependencies and produce a build:

```console
cd frontend
npm install
npm run build
```

For development with hot reload, keep the bot running on port 8080 and run:

```console
npm run dev
```

Vite proxies `/api` requests to the local bot. Production changes should always
be followed by `npm run build` so the `web/` output matches the React source.


## Future features
- help improvement
- secret rolls
- localization
- video guide into full bot functionality
- web-site for jokes uploads
- tests
- etc

## Known issues
- terra incognita
