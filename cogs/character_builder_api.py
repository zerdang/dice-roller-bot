"""Character-creation drafts: session and CSRF protections are supplied by Companion."""
import asyncio
from aiohttp import web
from functions.dnd import DndError


class CharacterBuilderApi:
    def __init__(self, store, auth):
        self.store, self.auth = store, auth

    def register(self, app):
        app.router.add_get("/api/dnd/creation/settings", self.settings)
        app.router.add_put("/api/dnd/creation/settings", self.save_settings)
        app.router.add_get("/api/dnd/creation/drafts", self.list_drafts)
        app.router.add_post("/api/dnd/creation/drafts", self.create)
        app.router.add_get("/api/dnd/creation/drafts/{draft_id}", self.get)
        app.router.add_put("/api/dnd/creation/drafts/{draft_id}", self.save)
        app.router.add_post("/api/dnd/creation/drafts/{draft_id}/preview", self.preview)
        app.router.add_post("/api/dnd/creation/drafts/{draft_id}/roll", self.roll)
        app.router.add_get("/api/dnd/creation/drafts/{draft_id}/options", self.options)

    async def call(self, method, *args, **kwargs):
        try:
            return web.json_response(await asyncio.to_thread(method, *args, **kwargs))
        except DndError as error:
            raise {403: web.HTTPForbidden, 404: web.HTTPNotFound, 409: web.HTTPConflict}.get(error.status, web.HTTPBadRequest)(text=str(error))

    @staticmethod
    async def body(request):
        try:
            result = await request.json()
        except ValueError:
            raise web.HTTPBadRequest(text="JSON object required")
        if not isinstance(result, dict):
            raise web.HTTPBadRequest(text="JSON object required")
        return result

    async def settings(self, request):
        return await self.call(self.store.settings, self.auth(request))

    async def save_settings(self, request):
        auth = self.auth(request)
        return await self.call(self.store.save_settings, auth, await self.body(request))

    async def list_drafts(self, request):
        return await self.call(self.store.list_drafts, self.auth(request))

    async def create(self, request):
        auth = self.auth(request)
        return await self.call(self.store.create, auth, await self.body(request))

    async def get(self, request):
        return await self.call(self.store.get, self.auth(request), request.match_info["draft_id"])

    async def save(self, request):
        auth = self.auth(request)
        return await self.call(self.store.save, auth, request.match_info["draft_id"], await self.body(request))

    async def preview(self, request):
        auth = self.auth(request)
        return await self.call(self.store.preview, auth, request.match_info["draft_id"], await self.body(request))

    async def roll(self, request):
        return await self.call(self.store.roll, self.auth(request), request.match_info["draft_id"])

    async def options(self, request):
        auth = self.auth(request)
        try:
            offset = int(request.query.get("offset", 0))
        except ValueError:
            raise web.HTTPBadRequest(text="Invalid page offset")
        return await self.call(self.store.options, auth, request.match_info["draft_id"], request.query.get("kind", "class"), request.query.get("q", ""), request.query.get("source", ""), request.query.get("edition", ""), offset)
