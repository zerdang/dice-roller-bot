"""aiohttp routes for the D&D battlemap workspace."""

from __future__ import annotations
import time

from aiohttp import web

from functions.battlemap import BattlemapStore, MapError


class BattlemapApi:
    def __init__(self, store: BattlemapStore, auth):
        self.store = store
        self.auth = auth
        self.pings = {}

    def register(self, app: web.Application) -> None:
        app.router.add_get("/api/games", self.games)
        app.router.add_get("/api/battlemap/scenes", self.scenes)
        app.router.add_post("/api/battlemap/scenes", self.create_scene)
        app.router.add_patch("/api/battlemap/scenes/{scene_id}", self.update_scene)
        app.router.add_post("/api/battlemap/scenes/{scene_id}/duplicate", self.duplicate_scene)
        app.router.add_delete("/api/battlemap/scenes/{scene_id}", self.delete_scene)
        app.router.add_get("/api/battlemap/state", self.state)
        app.router.add_post("/api/battlemap/assets", self.upload_asset)
        app.router.add_get("/api/battlemap/assets/{asset_id}", self.get_asset)
        app.router.add_post("/api/battlemap/scenes/{scene_id}/tokens", self.create_token)
        app.router.add_patch("/api/battlemap/tokens/{token_id}", self.update_token)
        app.router.add_post("/api/battlemap/tokens/{token_id}/counters/{key}/delta", self.counter_delta)
        app.router.add_post("/api/battlemap/scenes/{scene_id}/annotations", self.create_annotation)
        app.router.add_patch("/api/battlemap/annotations/{annotation_id}", self.update_annotation)
        app.router.add_delete("/api/battlemap/{entity_type}/{entity_id}", self.delete_entity)
        app.router.add_post("/api/battlemap/undo", self.undo)
        app.router.add_get("/api/battlemap/pings", self.get_pings)
        app.router.add_post("/api/battlemap/pings", self.post_ping)
        app.router.add_post("/api/battlemap/presets", self.create_preset)
        app.router.add_patch("/api/battlemap/presets/{preset_id}", self.update_preset)
        app.router.add_delete("/api/battlemap/presets/{preset_id}", self.delete_preset)

    @staticmethod
    async def games(_request: web.Request) -> web.Response:
        return web.json_response({
            "default": "dnd",
            "games": [
                {"id": "dnd", "label": "D&D", "route": "/dnd", "capabilities": ["battlemap"]},
                {"id": "mothership", "label": "Mothership", "route": "/mothership", "capabilities": ["sheets", "legacy-minimap"]},
            ],
        })

    @staticmethod
    async def _body(request: web.Request) -> dict:
        value = await request.json()
        if not isinstance(value, dict):
            raise MapError("JSON object required")
        return value

    @staticmethod
    def _id(request: web.Request, name: str) -> int:
        try:
            return int(request.match_info[name])
        except (KeyError, TypeError, ValueError) as error:
            raise MapError("Invalid identifier") from error

    async def _run(self, call):
        try:
            return await call()
        except MapError as error:
            http_error = {
                400: web.HTTPBadRequest, 403: web.HTTPForbidden,
                404: web.HTTPNotFound, 409: web.HTTPConflict,
            }.get(error.status, web.HTTPBadRequest)
            raise http_error(text=str(error))

    async def scenes(self, request):
        async def action(): return web.json_response(self.store.list_scenes(self.auth(request)))
        return await self._run(action)

    async def create_scene(self, request):
        async def action(): return web.json_response(self.store.create_scene(self.auth(request), await self._body(request)), status=201)
        return await self._run(action)

    async def update_scene(self, request):
        async def action(): return web.json_response(self.store.update_scene(self.auth(request), self._id(request, "scene_id"), await self._body(request)))
        return await self._run(action)

    async def duplicate_scene(self, request):
        async def action(): return web.json_response(self.store.duplicate_scene(self.auth(request), self._id(request, "scene_id"), request.headers.get("X-Operation-ID")), status=201)
        return await self._run(action)

    async def delete_scene(self, request):
        async def action():
            self.store.delete_scene(self.auth(request), self._id(request, "scene_id"), request.headers.get("X-Operation-ID")); return web.Response(status=204)
        return await self._run(action)

    async def state(self, request):
        async def action():
            value = request.query.get("scene_id")
            return web.json_response(self.store.snapshot(self.auth(request), int(value) if value else None))
        return await self._run(action)

    async def create_token(self, request):
        async def action(): return web.json_response(self.store.create_token(self.auth(request), self._id(request, "scene_id"), await self._body(request)), status=201)
        return await self._run(action)

    async def upload_asset(self, request):
        async def action():
            reader = await request.multipart()
            part = await reader.next()
            if not part or part.name != "file": raise MapError("Multipart file field is required")
            chunks, total = [], 0
            while True:
                chunk = await part.read_chunk()
                if not chunk: break
                total += len(chunk)
                if total > 20 * 1024 * 1024: raise MapError("Map image must be 20 MiB or smaller")
                chunks.append(chunk)
            return web.json_response(self.store.store_asset(self.auth(request), part.filename or "map", b"".join(chunks), request.headers.get("X-Operation-ID")), status=201)
        return await self._run(action)

    async def get_asset(self, request):
        async def action():
            path, media_type = self.store.asset(self.auth(request), request.match_info["asset_id"])
            return web.FileResponse(path, headers={"Content-Type": media_type, "Cache-Control": "private, max-age=3600"})
        return await self._run(action)

    async def update_token(self, request):
        async def action(): return web.json_response(self.store.update_token(self.auth(request), self._id(request, "token_id"), await self._body(request)))
        return await self._run(action)

    async def counter_delta(self, request):
        async def action():
            body = await self._body(request)
            return web.json_response(self.store.counter_delta(self.auth(request), self._id(request, "token_id"), request.match_info["key"], int(body["delta"]), int(body.get("revision", 0)), body.get("operation_id")))
        return await self._run(action)

    async def create_annotation(self, request):
        async def action(): return web.json_response(self.store.create_annotation(self.auth(request), self._id(request, "scene_id"), await self._body(request)), status=201)
        return await self._run(action)

    async def update_annotation(self, request):
        async def action(): return web.json_response(self.store.update_annotation(self.auth(request), self._id(request, "annotation_id"), await self._body(request)))
        return await self._run(action)

    async def delete_entity(self, request):
        async def action():
            kind = {"tokens": "token", "annotations": "annotation"}.get(request.match_info["entity_type"])
            if not kind: raise MapError("Invalid map object")
            self.store.delete_entity(self.auth(request), kind, self._id(request, "entity_id"), request.headers.get("X-Operation-ID"))
            return web.Response(status=204)
        return await self._run(action)

    async def undo(self, request):
        async def action(): return web.json_response(self.store.undo(self.auth(request)))
        return await self._run(action)

    async def get_pings(self, request):
        async def action():
            auth = self.auth(request); self.store._require_dnd(auth)
            now = time.monotonic()
            values = [ping for ping in self.pings.get(auth["campaign_id"], []) if ping["expires"] > now]
            self.pings[auth["campaign_id"]] = values
            return web.json_response([{key: value for key, value in ping.items() if key != "expires"} for ping in values])
        return await self._run(action)

    async def post_ping(self, request):
        async def action():
            auth = self.auth(request); body = await self._body(request)
            scene_id = int(body["scene_id"]); self.store.snapshot(auth, scene_id)
            ping = {"id": f"{time.monotonic_ns()}", "scene_id": scene_id, "x": float(body["x"]), "y": float(body["y"]), "expires": time.monotonic() + 3}
            self.pings.setdefault(auth["campaign_id"], []).append(ping)
            return web.json_response({key: value for key, value in ping.items() if key != "expires"}, status=201)
        return await self._run(action)

    async def create_preset(self, request):
        async def action(): return web.json_response(self.store.upsert_preset(self.auth(request), await self._body(request)), status=201)
        return await self._run(action)

    async def update_preset(self, request):
        async def action(): return web.json_response(self.store.upsert_preset(self.auth(request), await self._body(request), self._id(request, "preset_id")))
        return await self._run(action)

    async def delete_preset(self, request):
        async def action():
            self.store.delete_preset(self.auth(request), self._id(request, "preset_id"), request.headers.get("X-Operation-ID")); return web.Response(status=204)
        return await self._run(action)
