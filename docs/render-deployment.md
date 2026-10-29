# Render deployment

The companion is deployed as one Docker web service. Docker is intentional: the production image needs a Node 22
stage to run locked frontend tests/build and a Python 3.12 stage for aiohttp. The running container does not include
Node, npm caches, source campaign data, or repository secrets.

## Render form values

Deploy only after the Discord OAuth feature PR has been reviewed into `main`. For the existing form, use:

| Setting | Value |
| --- | --- |
| Region | Virginia |
| Runtime | Docker |
| Branch | `main` after both PRs are integrated |
| Root directory | blank (repository root) |
| Dockerfile | `./Dockerfile` |
| Build command | leave blank; Dockerfile controls the build |
| Start command | leave blank; image command is `python standalone.py` |
| Health check | `/healthz` |
| Compute | `0.5 CPU / 512 MB` (`0.5c-512mb`) |
| Instances | 1 |
| Persistent disk | name `tabletop-data`, mount `/var/data`, 1 GB initially |
| Auto-deploy | Off initially |

Set these non-secret environment variables:

```text
COMPANION_DB=/var/data/companion.db
COMPANION_ASSETS=/var/data/companion-assets
COMPANION_PUBLIC_URL=https://dm-screen.onrender.com
DISCORD_REDIRECT_URI=https://dm-screen.onrender.com/auth/discord/callback
SESSION_TTL_SECONDS=604800
COMPANION_ALLOW_LEGACY_BEARER=false
```

Also set `DISCORD_CLIENT_ID` and secret `DISCORD_CLIENT_SECRET` from the Discord
Developer Portal. See [discord-oauth.md](discord-oauth.md) for the portal and
cutover procedure.

Render injects `PORT`; do not set a fixed production port. After the first successful deployment, set
`COMPANION_PUBLIC_URL` to the service's exact `https://...onrender.com` origin if Discord-generated links will point
at Render. No Discord bot token is required by the standalone web process.

The checked-in `render.yaml` expresses the same settings and keeps automatic deployment off. Start with manual
deploys so a merge cannot restart an active game. Once mainline checks are reliable, the optional setting is **After
CI Checks Pass** (`autoDeployTrigger: checksPass`). A persistent disk fixes the service at one instance; do not scale
SQLite across independent writers.

The 512 MB plan is a reasonable initial fit for one weekly group: uploads are capped at 20 MiB and the server parses
headers without decoding map pixels. A request can briefly hold roughly twice the compressed upload size. Browser
clients, not the service, decode images. Monitor Render memory/CPU and move to 1 GB only if measured usage warrants it.

## Public and protected routes

`/`, `/invite/*`, compiled `/assets/*`, fixed `/images/*`, `/api/games`, `/api/auth/begin`, the OAuth callback, and
`/healthz` are public and contain no campaign state. `/api/auth/me`, campaign/invitation management,
`/api/dashboard`, and every `/api/battlemap/*` route require an expiring server-side session. Every mutation also
requires CSRF validation. Asset downloads recheck campaign, active-scene, hidden-token, and role rules server-side.
Render HTTPS does not replace authentication.

Legacy bearer links are rejected when `COMPANION_ALLOW_LEGACY_BEARER=false`, the required production setting. A
temporary `true` value exists only for an explicit migration window; see the cutover policy in
[discord-oauth.md](discord-oauth.md).

## Existing-data migration and backup

Migrations run when the application starts, after `/var/data` is mounted. They never run during the Docker build.
Before first migration, stop all writers. Make a consistent SQLite backup with Python's SQLite backup API and copy the
asset directory while the bot remains stopped:

```powershell
python scripts/backup_companion.py --database databases/companion.db --assets databases/companion-assets --output backups
```

The output directory contains `companion.db`, `companion-assets/`, and a manifest. Verify it before transferring.
Transfer it to the mounted disk only through a private authenticated method; never commit it or expose it at a public
URL. On Render, place the database at `/var/data/companion.db` and assets at `/var/data/companion-assets`, then start
one service instance. Test migrations first against a copy locally.

For rollback: turn off auto-deploy, stop/maintenance the service, retain a backup of the current disk state, restore
the paired database and asset backup, deploy the previously known-good commit/image, and check `/healthz` plus one
DM and one player login. Database migrations are forward-only, so application rollback without its paired data
backup is not guaranteed. Render disk snapshots are useful additional protection but do not replace export testing.

## Smoke check

After a manual deploy, confirm `/healthz` returns only `{"status":"ok"}`. Sign in with a DM account, verify its
campaign list, create and revoke an invitation, and accept a fresh invitation with a separate player account. Check
D&D scene load, authorized portrait/map assets, a token move, logout, reconnect, and persistence across one manual
restart. Finally select an existing Mothership campaign and verify sheets, inventory, rolls, turn order, and minimap.
