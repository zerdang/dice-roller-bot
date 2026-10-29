import tempfile
import unittest
from pathlib import Path

from aiohttp.test_utils import TestClient, TestServer

from cogs.companion import Companion


class StandaloneHttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.db_path = str(root / "companion.db")
        self.asset_path = str(root / "assets")
        self.service = Companion(None, self.db_path, self.asset_path)
        self.client = TestClient(TestServer(self.service.create_web_app()))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        self.temp.cleanup()

    async def test_health_is_public_and_contains_no_state(self):
        response = await self.client.get("/healthz")
        self.assertEqual(200, response.status)
        self.assertEqual({"status": "ok"}, await response.json())

    async def test_api_still_requires_bearer_auth(self):
        response = await self.client.get("/api/dashboard")
        self.assertEqual(401, response.status)

    async def test_standalone_process_serves_authorized_dnd_api(self):
        self.service.store.create_campaign("guild", "Dungeon", "dm", "dnd")
        token = self.service.store.rotate_warden_token("guild", "dm", "dnd")
        headers = {"Authorization": f"Bearer {token}"}
        response = await self.client.post("/api/battlemap/scenes", headers=headers, json={"name": "Room"})
        self.assertEqual(201, response.status)
        state = await self.client.get("/api/battlemap/state", headers=headers)
        self.assertEqual("Room", (await state.json())["scene"]["name"])

    async def test_state_survives_service_restart(self):
        self.service.store.create_campaign("guild", "Dungeon", "dm", "dnd")
        token = self.service.store.rotate_warden_token("guild", "dm", "dnd")
        headers = {"Authorization": f"Bearer {token}"}
        await self.client.post("/api/battlemap/scenes", headers=headers, json={"name": "Persistent room"})

        restarted = Companion(None, self.db_path, self.asset_path)
        restarted_client = TestClient(TestServer(restarted.create_web_app()))
        await restarted_client.start_server()
        try:
            state = await restarted_client.get("/api/battlemap/state", headers=headers)
            self.assertEqual("Persistent room", (await state.json())["scene"]["name"])
        finally:
            await restarted_client.close()


if __name__ == "__main__":
    unittest.main()
