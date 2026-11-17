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

    def sign_in(self, discord_id="1001"):
        self.service.web_auth.upsert_identity({"id": discord_id, "username": f"user-{discord_id}"})
        session, csrf = self.service.web_auth.create_session(discord_id)
        self.client.session.cookie_jar.update_cookies({"dm_session": session, "dm_csrf": csrf})
        return {"X-CSRF-Token": csrf}

    async def asyncTearDown(self):
        await self.client.close()
        self.temp.cleanup()

    async def test_health_is_public_and_contains_no_state(self):
        response = await self.client.get("/healthz")
        self.assertEqual(200, response.status)
        self.assertEqual({"status": "ok"}, await response.json())

    async def test_api_requires_a_web_session_and_rejects_legacy_bearer_by_default(self):
        response = await self.client.get("/api/dashboard")
        self.assertEqual(401, response.status)
        self.service.store.create_campaign("guild", "Dungeon", "dm", "dnd")
        token = self.service.store.rotate_warden_token("guild", "dm", "dnd")
        response = await self.client.get("/api/dashboard", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(401, response.status)

    async def test_standalone_process_serves_session_authorized_dnd_api(self):
        campaign = self.service.store.create_campaign("guild", "Dungeon", "1001", "dnd")
        headers = self.sign_in()
        self.service.web_auth.select_campaign(
            self.client.session.cookie_jar.filter_cookies(self.client.make_url("/"))["dm_session"].value,
            "1001", campaign["id"]
        )
        response = await self.client.post("/api/battlemap/scenes", headers=headers, json={"name": "Room"})
        self.assertEqual(201, response.status)
        state = await self.client.get("/api/battlemap/state", headers=headers)
        self.assertEqual("Room", (await state.json())["scene"]["name"])

    async def test_state_survives_service_restart(self):
        campaign = self.service.store.create_campaign("guild", "Dungeon", "1001", "dnd")
        headers = self.sign_in()
        cookies = self.client.session.cookie_jar.filter_cookies(self.client.make_url("/"))
        token = cookies["dm_session"].value
        self.service.web_auth.select_campaign(token, "1001", campaign["id"])
        await self.client.post("/api/battlemap/scenes", headers=headers, json={"name": "Persistent room"})

        restarted = Companion(None, self.db_path, self.asset_path)
        restarted_client = TestClient(TestServer(restarted.create_web_app()))
        await restarted_client.start_server()
        try:
            restarted_client.session.cookie_jar.update_cookies({"dm_session": token})
            state = await restarted_client.get("/api/battlemap/state")
            self.assertEqual("Persistent room", (await state.json())["scene"]["name"])
        finally:
            await restarted_client.close()


if __name__ == "__main__":
    unittest.main()
