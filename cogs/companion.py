"""Discord commands and standalone OAuth web server for the tabletop companion."""

import asyncio
import secrets
import time
from pathlib import Path
from typing import Literal
from urllib.parse import urlencode

import discord
import aiohttp
from aiohttp import web
from discord import app_commands
from discord.ext import commands

from functions.companion import CompanionStore
from functions.battlemap import BattlemapStore
from functions.web_auth import AuthError, WebAuthStore
from cogs.battlemap_api import BattlemapApi
from functions.config import (
    allow_legacy_bearer, companion_assets, companion_db, companion_enabled,
    companion_host, companion_port, companion_public_url, discord_client_id,
    discord_client_secret, discord_redirect_uri, session_cookie_secure,
    session_ttl_seconds,
)


WEB_ROOT = Path(__file__).resolve().parent.parent / "web"


class Companion(commands.Cog):
    tabletop = app_commands.Group(name="tabletop", description="Manage the tabletop companion")

    def __init__(self, bot: commands.Bot | None, db_path: str = companion_db,
                 asset_root: str = companion_assets, oauth_config: dict | None = None):
        self.bot = bot
        self.store = CompanionStore(db_path)
        self.battlemap = BattlemapStore(db_path, asset_root)
        self.web_auth = WebAuthStore(db_path, session_ttl_seconds)
        config = oauth_config or {}
        self.discord_client_id = config.get("client_id", discord_client_id)
        self.discord_client_secret = config.get("client_secret", discord_client_secret)
        self.discord_redirect_uri = config.get("redirect_uri", discord_redirect_uri)
        self.public_url = config.get("public_url", companion_public_url).rstrip("/")
        self.cookie_secure = config.get("cookie_secure", session_cookie_secure)
        self.legacy_bearer = config.get("allow_legacy_bearer", allow_legacy_bearer)
        self._rates: dict[tuple[str, str], list[float]] = {}
        self.runner: web.AppRunner | None = None

    async def cog_load(self) -> None:
        if not companion_enabled:
            return
        app = self.create_web_app()
        self.runner = web.AppRunner(app)
        await self.runner.setup()
        await web.TCPSite(self.runner, companion_host, companion_port).start()

    def create_web_app(self) -> web.Application:
        """Build the authenticated web application without connecting to Discord."""
        @web.middleware
        async def security(request, handler):
            return await self.security_middleware(request, handler)

        app = web.Application(client_max_size=21 * 1024 * 1024, middlewares=[security])
        app.router.add_get("/healthz", self.health)
        app.router.add_get("/", self.index)
        app.router.add_get("/invite/{token}", self.invite_index)
        app.router.add_post("/api/auth/begin", self.begin_discord_login)
        app.router.add_get("/auth/discord/callback", self.discord_callback)
        app.router.add_get("/api/auth/me", self.get_me)
        app.router.add_post("/api/auth/logout", self.logout)
        app.router.add_post("/api/campaigns", self.post_campaign)
        app.router.add_post("/api/campaigns/select", self.select_campaign)
        app.router.add_get("/api/invitations", self.get_invitations)
        app.router.add_post("/api/invitations", self.post_invitation)
        app.router.add_post("/api/invitations/accept", self.accept_invitation)
        app.router.add_delete("/api/invitations/{token_hash}", self.delete_invitation)
        app.router.add_static("/assets/", WEB_ROOT / "assets")
        app.router.add_static("/images/", WEB_ROOT / "images")
        app.router.add_get("/api/dashboard", self.get_dashboard)
        app.router.add_patch("/api/characters/{character_id}", self.patch_character)
        app.router.add_post("/api/characters/{character_id}/rolls", self.post_character_roll)
        app.router.add_post("/api/characters/{character_id}/damage-rolls", self.post_damage_roll)
        app.router.add_post("/api/turn-order/enemies", self.post_enemy)
        app.router.add_patch("/api/turn-order", self.patch_turn_order)
        app.router.add_delete("/api/turn-order/enemies/{entry_id}", self.delete_enemy)
        app.router.add_patch("/api/map-visibility", self.patch_map_visibility)
        app.router.add_post("/api/characters/{character_id}/items", self.post_item)
        app.router.add_patch("/api/characters/{character_id}/items/order", self.patch_item_order)
        app.router.add_patch("/api/items/{item_id}", self.patch_item)
        app.router.add_delete("/api/items/{item_id}", self.delete_item)
        BattlemapApi(self.battlemap, self.auth).register(app)
        return app

    async def cog_unload(self) -> None:
        if self.runner:
            await self.runner.cleanup()

    @staticmethod
    async def index(_request: web.Request) -> web.FileResponse:
        return web.FileResponse(WEB_ROOT / "index.html")

    @staticmethod
    async def invite_index(_request: web.Request) -> web.FileResponse:
        return web.FileResponse(WEB_ROOT / "index.html")

    @staticmethod
    async def health(_request: web.Request) -> web.Response:
        return web.json_response({"status": "ok"}, headers={"Cache-Control": "no-store"})

    def _session(self, request: web.Request, required: bool = True):
        cached = request.get("web_session")
        if cached:
            return cached
        value = self.web_auth.session(request.cookies.get("dm_session"))
        if not value and required:
            raise web.HTTPUnauthorized(text="Your session is missing or expired.")
        if value:
            request["web_session"] = value
        return value

    def auth(self, request: web.Request):
        session = self._session(request, required=False)
        if session:
            auth = self.web_auth.authorize(session["discord_user_id"], session["active_campaign_id"])
            if not auth:
                raise web.HTTPForbidden(text="Select a campaign you belong to.")
            auth["auth_method"] = "session"
            return auth
        header = request.headers.get("Authorization", "")
        if not self.legacy_bearer or not header.startswith("Bearer "):
            raise web.HTTPUnauthorized(text="Sign in with Discord to continue.")
        auth = self.store.authorize(header[7:])
        if not auth:
            raise web.HTTPUnauthorized(text="Invalid or expired access token")
        auth["auth_method"] = "legacy_bearer"
        return auth

    async def security_middleware(self, request: web.Request, handler):
        response = await self._secure_request(request, handler)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        response.headers.setdefault("X-Frame-Options", "DENY")
        if request.path.startswith("/api/") or request.path.startswith("/auth/"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response

    async def _secure_request(self, request: web.Request, handler):
        unsafe = request.method not in {"GET", "HEAD", "OPTIONS"}
        exempt = request.path == "/api/auth/begin"
        if unsafe and request.path.startswith("/api/") and not exempt:
            session = self._session(request, required=False)
            if session:
                if not self.web_auth.check_csrf(session, request.headers.get("X-CSRF-Token")):
                    raise web.HTTPForbidden(text="CSRF validation failed.")
            elif not (self.legacy_bearer and request.headers.get("Authorization", "").startswith("Bearer ")):
                raise web.HTTPUnauthorized(text="Sign in with Discord to continue.")
        return await handler(request)

    def _limited(self, request: web.Request, bucket: str, limit: int, window: int = 900) -> bool:
        forwarded = request.headers.get("X-Forwarded-For", "").split(",", 1)[0].strip()
        remote = forwarded or request.remote or "unknown"
        key, now = (bucket, remote), time.monotonic()
        values = [value for value in self._rates.get(key, []) if value > now - window]
        if len(values) >= limit:
            self._rates[key] = values
            return True
        values.append(now)
        self._rates[key] = values
        return False

    def _set_auth_cookies(self, response: web.StreamResponse, session: str, csrf: str) -> None:
        response.set_cookie("dm_session", session, max_age=session_ttl_seconds, secure=self.cookie_secure,
                            httponly=True, samesite="Lax", path="/")
        response.set_cookie("dm_csrf", csrf, max_age=session_ttl_seconds, secure=self.cookie_secure,
                            httponly=False, samesite="Strict", path="/")

    async def begin_discord_login(self, request: web.Request) -> web.Response:
        if self._limited(request, "oauth-begin", 20):
            raise web.HTTPTooManyRequests(text="Too many sign-in attempts. Try again later.")
        if not self.discord_client_id or not self.discord_client_secret or not self.discord_redirect_uri:
            raise web.HTTPServiceUnavailable(text="Discord sign-in is not configured on this server.")
        try:
            body = await request.json()
            invite = body.get("invite") if isinstance(body, dict) else None
            browser = request.cookies.get("dm_oauth_browser") or secrets.token_urlsafe(32)
            state = self.web_auth.create_state(browser, invite)
        except (ValueError, AuthError) as error:
            raise web.HTTPBadRequest(text=str(error))
        query = urlencode({"client_id": self.discord_client_id, "redirect_uri": self.discord_redirect_uri,
                           "response_type": "code", "scope": "identify", "state": state})
        response = web.json_response({"authorize_url": f"https://discord.com/oauth2/authorize?{query}"})
        response.set_cookie("dm_oauth_browser", browser, max_age=600, secure=self.cookie_secure,
                            httponly=True, samesite="Lax", path="/")
        return response

    async def exchange_discord_code(self, code: str) -> dict:
        timeout = aiohttp.ClientTimeout(total=10)
        async with aiohttp.ClientSession(timeout=timeout) as client:
            async with client.post(
                "https://discord.com/api/v10/oauth2/token",
                data={"grant_type": "authorization_code", "code": code, "redirect_uri": self.discord_redirect_uri},
                auth=aiohttp.BasicAuth(self.discord_client_id, self.discord_client_secret),
            ) as response:
                if response.status != 200:
                    raise AuthError("Discord rejected or expired the authorization code.")
                return await response.json()

    async def fetch_discord_identity(self, access_token: str) -> dict:
        timeout = aiohttp.ClientTimeout(total=10)
        async with aiohttp.ClientSession(timeout=timeout) as client:
            async with client.get("https://discord.com/api/v10/users/@me",
                                  headers={"Authorization": f"Bearer {access_token}"}) as response:
                if response.status != 200:
                    raise AuthError("Discord could not verify this identity.")
                return await response.json()

    async def discord_callback(self, request: web.Request) -> web.Response:
        if self._limited(request, "oauth-callback", 30):
            raise web.HTTPTooManyRequests(text="Too many sign-in attempts. Try again later.")
        state = request.query.get("state", "")
        browser = request.cookies.get("dm_oauth_browser", "")
        try:
            invite_hash = self.web_auth.consume_state(state, browser)
            if request.query.get("error"):
                raise web.HTTPFound("/?auth=cancelled")
            code = request.query.get("code", "")
            if not code:
                raise AuthError("Discord did not return an authorization code.")
            token_data = await self.exchange_discord_code(code)
            if token_data.get("scope") and "identify" not in token_data["scope"].split():
                raise AuthError("Discord did not grant the required identity scope.")
            identity = await self.fetch_discord_identity(str(token_data.get("access_token", "")))
            user_id = self.web_auth.upsert_identity(identity)
            session_token, csrf = self.web_auth.create_session(user_id, request.cookies.get("dm_session"))
            memberships = self.web_auth.memberships(user_id)
            selected = None
            if invite_hash:
                selected = self.web_auth.accept_invite_hash(
                    invite_hash, user_id, identity.get("global_name") or identity.get("username") or "Player"
                )
            elif memberships:
                selected = memberships[0]["id"]
            if selected:
                self.web_auth.select_campaign(session_token, user_id, int(selected))
            response = web.HTTPFound("/?auth=success")
            self._set_auth_cookies(response, session_token, csrf)
            response.del_cookie("dm_oauth_browser", path="/")
            raise response
        except (AuthError, asyncio.TimeoutError, aiohttp.ClientError, ValueError):
            raise web.HTTPFound("/?auth=failed")

    async def get_me(self, request: web.Request) -> web.Response:
        session = self._session(request)
        campaigns = self.web_auth.memberships(session["discord_user_id"])
        return web.json_response({
            "user": {"id": session["discord_user_id"], "username": session["username"],
                     "global_name": session["global_name"], "avatar": session["avatar"]},
            "campaigns": campaigns, "active_campaign_id": session["active_campaign_id"],
        }, headers={"Cache-Control": "no-store"})

    async def logout(self, request: web.Request) -> web.Response:
        self.web_auth.revoke_session(request.cookies.get("dm_session"))
        response = web.json_response({"ok": True})
        response.del_cookie("dm_session", path="/")
        response.del_cookie("dm_csrf", path="/")
        return response

    async def post_campaign(self, request: web.Request) -> web.Response:
        session = self._session(request)
        try:
            body = await request.json()
            campaign = self.web_auth.create_campaign(session["discord_user_id"], body.get("name", ""),
                                                     body.get("game_system", "dnd"))
            self.web_auth.select_campaign(request.cookies["dm_session"], session["discord_user_id"], campaign["id"])
            return web.json_response(campaign, status=201)
        except (AttributeError, AuthError, ValueError) as error:
            raise web.HTTPBadRequest(text=str(error))

    async def select_campaign(self, request: web.Request) -> web.Response:
        session = self._session(request)
        try:
            campaign_id = int((await request.json())["campaign_id"])
        except (KeyError, TypeError, ValueError):
            raise web.HTTPBadRequest(text="A valid campaign is required.")
        if not self.web_auth.select_campaign(request.cookies["dm_session"], session["discord_user_id"], campaign_id):
            raise web.HTTPForbidden(text="You are not a member of that campaign.")
        return web.json_response({"ok": True})

    async def post_invitation(self, request: web.Request) -> web.Response:
        if self._limited(request, "invite-create", 30, 3600):
            raise web.HTTPTooManyRequests(text="Too many invitations created. Try again later.")
        token = self.web_auth.create_invite(self.auth(request))
        return web.json_response({"url": f"{self.public_url}/#invite={token}"}, status=201)

    async def get_invitations(self, request: web.Request) -> web.Response:
        return web.json_response(self.web_auth.list_invites(self.auth(request)))

    async def delete_invitation(self, request: web.Request) -> web.Response:
        if not self.web_auth.revoke_invite(self.auth(request), request.match_info["token_hash"]):
            raise web.HTTPNotFound(text="Invitation not found.")
        return web.Response(status=204)

    async def accept_invitation(self, request: web.Request) -> web.Response:
        if self._limited(request, "invite-accept", 20):
            raise web.HTTPTooManyRequests(text="Too many invitation attempts. Try again later.")
        session = self._session(request)
        try:
            token = str((await request.json())["token"])
            campaign_id = self.web_auth.accept_invite(
                token, session["discord_user_id"], session["global_name"] or session["username"]
            )
            self.web_auth.select_campaign(request.cookies["dm_session"], session["discord_user_id"], campaign_id)
            return web.json_response({"ok": True, "campaign_id": campaign_id})
        except (KeyError, TypeError, AuthError) as error:
            raise web.HTTPBadRequest(text=str(error))

    async def get_dashboard(self, request: web.Request) -> web.Response:
        return web.json_response(self.store.dashboard(self.auth(request)))

    async def patch_character(self, request: web.Request) -> web.Response:
        auth = self.auth(request)
        try:
            character_id = int(request.match_info["character_id"])
            payload = await request.json()
            if not isinstance(payload, dict):
                raise ValueError
            updated = self.store.update_character(auth, character_id, payload)
        except (TypeError, ValueError):
            raise web.HTTPBadRequest(text="Invalid character update")
        if not updated:
            raise web.HTTPForbidden(text="Character cannot be updated")
        return web.json_response({"ok": True})

    async def post_character_roll(self, request: web.Request) -> web.Response:
        auth = self.auth(request)
        try:
            character_id = int(request.match_info["character_id"])
            payload = await request.json()
            if not isinstance(payload, dict):
                raise ValueError
            result = self.store.roll_character_stat(
                auth, character_id, payload.get("stat", ""),
                payload.get("skill", ""), payload.get("roll_mode", "normal")
            )
        except (TypeError, ValueError):
            raise web.HTTPBadRequest(text="Invalid stat roll")
        if result is None:
            raise web.HTTPForbidden(text="This character cannot be rolled")
        return web.json_response(result, status=201)

    async def post_enemy(self, request: web.Request) -> web.Response:
        auth = self.auth(request)
        try:
            payload = await request.json()
            entry_id = self.store.add_enemy(auth, payload.get("name", ""))
        except (AttributeError, TypeError, ValueError):
            raise web.HTTPBadRequest(text="Invalid enemy")
        if entry_id is None:
            raise web.HTTPForbidden(text="Only the warden can edit turn order")
        return web.json_response({"ok": True, "id": entry_id}, status=201)

    async def patch_turn_order(self, request: web.Request) -> web.Response:
        auth = self.auth(request)
        try:
            payload = await request.json()
            entry_ids = [int(entry_id) for entry_id in payload["entry_ids"]]
        except (KeyError, TypeError, ValueError):
            raise web.HTTPBadRequest(text="Invalid turn order")
        if not self.store.reorder_turns(auth, entry_ids):
            raise web.HTTPForbidden(text="Only the warden can edit turn order")
        return web.json_response({"ok": True})

    async def delete_enemy(self, request: web.Request) -> web.Response:
        auth = self.auth(request)
        try:
            deleted = self.store.delete_enemy(auth, int(request.match_info["entry_id"]))
        except ValueError:
            raise web.HTTPBadRequest(text="Invalid enemy")
        if not deleted:
            raise web.HTTPForbidden(text="Only the warden can remove enemies")
        return web.json_response({"ok": True})

    async def patch_map_visibility(self, request: web.Request) -> web.Response:
        auth = self.auth(request)
        try:
            payload = await request.json()
        except (TypeError, ValueError):
            raise web.HTTPBadRequest(text="Invalid map visibility")
        if not self.store.update_map_visibility(auth, payload):
            raise web.HTTPForbidden(text="Only the warden can reveal the map")
        return web.json_response({"ok": True})

    async def post_damage_roll(self, request: web.Request) -> web.Response:
        auth = self.auth(request)
        try:
            character_id = int(request.match_info["character_id"])
            payload = await request.json()
            if not isinstance(payload, dict):
                raise ValueError
            result = self.store.roll_weapon_damage(auth, character_id, int(payload.get("item_id", 0)))
        except (TypeError, ValueError):
            raise web.HTTPBadRequest(text="Invalid weapon damage roll")
        if result is None:
            raise web.HTTPForbidden(text="This weapon cannot be rolled")
        return web.json_response(result, status=201)

    async def post_item(self, request: web.Request) -> web.Response:
        auth = self.auth(request)
        try:
            character_id = int(request.match_info["character_id"])
            payload = await request.json()
            if not isinstance(payload, dict):
                raise ValueError
            item_id = self.store.add_item(auth, character_id, payload)
        except (TypeError, ValueError):
            raise web.HTTPBadRequest(text="Invalid item")
        if item_id is None:
            raise web.HTTPForbidden(text="Inventory cannot be updated")
        return web.json_response({"ok": True, "id": item_id}, status=201)

    async def patch_item(self, request: web.Request) -> web.Response:
        auth = self.auth(request)
        try:
            item_id = int(request.match_info["item_id"])
            payload = await request.json()
            if not isinstance(payload, dict):
                raise ValueError
            updated = self.store.update_item(auth, item_id, payload)
        except (TypeError, ValueError):
            raise web.HTTPBadRequest(text="Invalid item update")
        if not updated:
            raise web.HTTPForbidden(text="Item cannot be updated")
        return web.json_response({"ok": True})

    async def patch_item_order(self, request: web.Request) -> web.Response:
        auth = self.auth(request)
        try:
            character_id = int(request.match_info["character_id"])
            payload = await request.json()
            item_ids = payload["item_ids"]
            if not isinstance(item_ids, list):
                raise ValueError
            item_ids = [int(item_id) for item_id in item_ids]
            updated = self.store.reorder_items(auth, character_id, item_ids)
        except (KeyError, TypeError, ValueError):
            raise web.HTTPBadRequest(text="Invalid inventory order")
        if not updated:
            raise web.HTTPForbidden(text="Inventory cannot be reordered")
        return web.json_response({"ok": True})

    async def delete_item(self, request: web.Request) -> web.Response:
        auth = self.auth(request)
        try:
            deleted = self.store.delete_item(auth, int(request.match_info["item_id"]))
        except ValueError:
            raise web.HTTPBadRequest(text="Invalid item id")
        if not deleted:
            raise web.HTTPForbidden(text="Item cannot be deleted")
        return web.json_response({"ok": True})

    @tabletop.command(name="setup", description="Create or rename your tabletop campaign")
    @app_commands.checks.has_permissions(administrator=True)
    async def setup_campaign(self, interaction: discord.Interaction, name: str,
                             game: Literal["dnd", "mothership"] = "dnd") -> None:
        if not interaction.guild_id:
            await interaction.response.send_message("Campaigns must be created in a server.", ephemeral=True)
            return
        campaign = self.store.create_campaign(
            str(interaction.guild_id), name[:100], str(interaction.user.id), game
        )
        if not campaign:
            await interaction.response.send_message(
                "This campaign is owned by another Discord account. Only its warden can change it.",
                ephemeral=True,
            )
            return
        await interaction.response.send_message(
            f"**{name[:100]}** ({game}) is ready and is now owned by your Discord account.\n\n"
            "Use `/tabletop warden-link` whenever you need a fresh management link.",
            ephemeral=True,
        )

    @tabletop.command(name="warden-link", description="Create a fresh private management link")
    async def warden_link(self, interaction: discord.Interaction,
                          game: Literal["dnd", "mothership"] = "mothership") -> None:
        if not interaction.guild_id:
            await interaction.response.send_message(
                "Warden links must be requested in your game server.", ephemeral=True
            )
            return
        token = self.store.rotate_warden_token(
            str(interaction.guild_id), str(interaction.user.id), game
        )
        if not token:
            await interaction.response.send_message(
                "Access denied. Only the Discord account that created this campaign can request its warden link.",
                ephemeral=True,
            )
            return
        if not self.legacy_bearer:
            await interaction.response.send_message(
                f"Open {companion_public_url.rstrip('/')} and sign in with Discord. "
                "Your verified Discord account already has DM access; private bearer links are disabled.",
                ephemeral=True,
            )
            return
        url = f"{companion_public_url.rstrip('/')}#token={token}"
        await interaction.response.send_message(
            f"Your new private warden dashboard:\n{url}\n\n"
            "This replaces the previous warden link. Keep it private: possession of the URL grants access.",
            ephemeral=True,
        )

    @tabletop.command(name="invite", description="Create or refresh a player's private character link")
    async def invite_player(self, interaction: discord.Interaction, player: discord.Member,
                            game: Literal["dnd", "mothership"] = "mothership") -> None:
        if not interaction.guild_id:
            await interaction.response.send_message("Player links must be created in a server.", ephemeral=True)
            return
        if not self.store.is_campaign_owner(str(interaction.guild_id), str(interaction.user.id), game):
            await interaction.response.send_message(
                "Access denied. Only the campaign's warden can manage player invitations.",
                ephemeral=True,
            )
            return
        created = self.store.create_or_rotate_player(
            str(interaction.guild_id), str(player.id), player.display_name, game
        )
        if not created:
            await interaction.response.send_message(
                "Run `/tabletop setup` before inviting players.", ephemeral=True
            )
            return
        _character, token = created
        if not self.legacy_bearer:
            await interaction.response.send_message(
                f"**{player.display_name}** can now open {companion_public_url.rstrip('/')} and sign in with Discord. "
                "For a single-use expiring invitation instead, use the website's **Invite player** control.",
                ephemeral=True,
            )
            return
        url = f"{companion_public_url.rstrip('/')}#token={token}"
        await interaction.response.send_message(
            f"Private player link for **{player.display_name}**:\n{url}\n\n"
            "Send it to them privately. Creating another invite rotates this link.",
            ephemeral=True,
        )

    @tabletop.command(name="link", description="Refresh your own private player link")
    async def player_link(self, interaction: discord.Interaction,
                          game: Literal["dnd", "mothership"] = "mothership") -> None:
        if not interaction.guild_id:
            await interaction.response.send_message("Use this command in your game server.", ephemeral=True)
            return
        created = self.store.create_or_rotate_player(
            str(interaction.guild_id), str(interaction.user.id), interaction.user.display_name, game
        )
        if not created:
            await interaction.response.send_message(
                "The warden needs to run `/tabletop setup` first.", ephemeral=True
            )
            return
        _character, token = created
        if not self.legacy_bearer:
            await interaction.response.send_message(
                f"Open {companion_public_url.rstrip('/')} and sign in with Discord. "
                "Your verified Discord account is linked to this character.",
                ephemeral=True,
            )
            return
        url = f"{companion_public_url.rstrip('/')}#token={token}"
        await interaction.response.send_message(
            f"Your private player dashboard:\n{url}\n\nThis replaces your previous link.",
            ephemeral=True,
        )


async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(Companion(bot))
