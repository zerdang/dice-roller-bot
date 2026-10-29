# Discord website sign-in and bearer-link cutover

The standalone site uses Discord's authorization-code flow with only the
`identify` scope. OAuth state, sessions, and invitations are stored in the same
SQLite database as campaigns. Discord access tokens are used once for
`/users/@me` and are not persisted.

## Discord Developer Portal

1. Open the existing application at <https://discord.com/developers/applications>.
2. Under **OAuth2**, add this exact redirect:
   `https://dm-screen.onrender.com/auth/discord/callback`.
3. Copy the Application ID and reset/copy the client secret. Put them directly
   into Render; do not put them in Git, a local config file that is committed,
   or chat.
4. No bot/server permission or privileged intent is required. The site requests
   only `identify`.

For local development, add `http://localhost:8080/auth/discord/callback` as a
second redirect and use the values in `.env.example`. Start with
`python standalone.py`. `SESSION_COOKIE_SECURE=false` is appropriate only for
local HTTP; production defaults to secure cookies.

## Render variables

The Docker service remains a single instance with its 1 GB persistent disk at
`/var/data`. Set:

| Variable | Value |
| --- | --- |
| `DISCORD_CLIENT_ID` | Application ID from Discord |
| `DISCORD_CLIENT_SECRET` | Secret from Discord (mark secret) |
| `DISCORD_REDIRECT_URI` | `https://dm-screen.onrender.com/auth/discord/callback` |
| `COMPANION_PUBLIC_URL` | `https://dm-screen.onrender.com` |
| `COMPANION_DB` | `/var/data/companion.db` |
| `COMPANION_ASSETS` | `/var/data/companion-assets` |
| `SESSION_TTL_SECONDS` | `604800` |
| `COMPANION_ALLOW_LEGACY_BEARER` | `false` |

Keep manual deploys enabled initially. The health path is `/healthz`; the
Dockerfile and start command remain `Dockerfile` / `python standalone.py`.

## Existing data and cutover

Startup adds authentication tables without rewriting campaigns, characters,
maps, inventory, or uploads. Existing `owner_discord_user_id` values become DM
memberships and existing character `discord_user_id` values become player
memberships. Blank IDs remain unlinked. Names are never used to infer identity.

Before deploying, make a consistent SQLite backup with the existing backup
script or stop the writer before copying `companion.db`, including any `-wal`
and `-shm` sidecars, together with `companion-assets`. Restore by stopping the
service, replacing that matched database/assets set, and restarting.

Production disables legacy bearer authentication by default. Old fragment
links then stop authorizing API requests, and bot link commands direct users to
Discord sign-in. If a short emergency transition is necessary, set
`COMPANION_ALLOW_LEGACY_BEARER=true`, redeploy, and remove it after users have
signed in. This is an explicit compatibility bypass and should not be left on.

After deployment:

1. Sign in as each known DM and verify the expected campaigns.
2. For a campaign with a missing/wrong owner ID, correct the verified Discord ID
   through an offline, backed-up database maintenance step; never match by name.
3. Have DMs generate website invitations for players not already linked by a
   character Discord ID.
4. Test one player account before declaring the bearer-link cutover complete.

Sessions are server-side, expire after seven days by default, rotate at login,
and are revoked at logout. Mutation requests require the session's CSRF token.
Invitation links expire after seven days, are single-use and revocable, and can
create player membership only.

The standalone process disables HTTP access logging because OAuth authorization
codes arrive in the callback query string. Application errors must likewise
avoid logging request cookies, authorization headers, callback queries, or
Discord token responses.
