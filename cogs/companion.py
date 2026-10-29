"""Discord commands and web server for the tabletop companion."""

from pathlib import Path
from typing import Literal

import discord
from aiohttp import web
from discord import app_commands
from discord.ext import commands

from functions.companion import CompanionStore
from functions.battlemap import BattlemapStore
from cogs.battlemap_api import BattlemapApi
from functions.config import companion_assets, companion_db, companion_enabled, companion_host, companion_port, companion_public_url


WEB_ROOT = Path(__file__).resolve().parent.parent / "web"


class Companion(commands.Cog):
    tabletop = app_commands.Group(name="tabletop", description="Manage the tabletop companion")

    def __init__(self, bot: commands.Bot | None, db_path: str = companion_db,
                 asset_root: str = companion_assets):
        self.bot = bot
        self.store = CompanionStore(db_path)
        self.battlemap = BattlemapStore(db_path, asset_root)
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
        app = web.Application(client_max_size=21 * 1024 * 1024)
        app.router.add_get("/healthz", self.health)
        app.router.add_get("/", self.index)
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
    async def health(_request: web.Request) -> web.Response:
        return web.json_response({"status": "ok"}, headers={"Cache-Control": "no-store"})

    def auth(self, request: web.Request):
        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            raise web.HTTPUnauthorized(text="Missing access token")
        auth = self.store.authorize(header[7:])
        if not auth:
            raise web.HTTPUnauthorized(text="Invalid or expired access token")
        return auth

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
        url = f"{companion_public_url.rstrip('/')}#token={token}"
        await interaction.response.send_message(
            f"Your private player dashboard:\n{url}\n\nThis replaces your previous link.",
            ephemeral=True,
        )


async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(Companion(bot))
