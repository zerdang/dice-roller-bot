"""Authenticated reference queries; catalog imports are operator-only CLI actions."""
import asyncio
from aiohttp import web
from functions.dnd import DndError


class ReferenceApi:
    def __init__(self, store, auth):
        self.store, self.auth = store, auth

    def register(self, app):
        app.router.add_get("/api/dnd/reference/meta", self.metadata)
        app.router.add_get("/api/dnd/reference", self.search)
        app.router.add_get("/api/dnd/reference/entries/{entry_id}", self.detail)
        app.router.add_put("/api/dnd/reference/policy", self.policy)

    async def call(self, method, *args, **kwargs):
        try:
            return web.json_response(await asyncio.to_thread(method, *args, **kwargs))
        except DndError as error:
            raise {403: web.HTTPForbidden, 404: web.HTTPNotFound}.get(error.status, web.HTTPBadRequest)(text=str(error))

    async def metadata(self, request):
        return await self.call(self.store.metadata, self.auth(request))

    async def search(self, request):
        auth = self.auth(request)
        try:
            offset = int(request.query.get("offset", 0))
        except ValueError:
            raise web.HTTPBadRequest(text="Invalid page offset")
        return await self.call(self.store.search, auth, request.query.get("q", ""),
                               request.query.get("kind", ""), request.query.get("source", ""),
                               request.query.get("edition", ""), offset)

    async def detail(self, request):
        return await self.call(self.store.detail, self.auth(request), request.match_info["entry_id"], request.query.get("version"))

    async def policy(self, request):
        auth = self.auth(request)
        try:
            body = await request.json()
        except ValueError:
            raise web.HTTPBadRequest(text="JSON object required")
        if not isinstance(body, dict) or "sources" not in body:
            raise web.HTTPBadRequest(text="sources is required (null means all sources)")
        return await self.call(self.store.set_policy, auth, body["sources"])
