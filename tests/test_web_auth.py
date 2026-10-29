import tempfile
import time
import unittest
from pathlib import Path

from aiohttp.test_utils import TestClient, TestServer

from cogs.companion import Companion
from functions.web_auth import AuthError, digest


class WebAuthStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.temp.name) / "companion.db")
        self.service = Companion(None, self.path, str(Path(self.temp.name) / "assets"))
        self.auth = self.service.web_auth
        self.auth.upsert_identity({"id": "1001", "username": "dm", "global_name": "Dungeon Master"})
        self.auth.upsert_identity({"id": "2002", "username": "player", "global_name": "Player"})

    def tearDown(self):
        self.temp.cleanup()

    def test_oauth_state_is_one_time_expiring_and_bound_to_browser(self):
        state = self.auth.create_state("browser-a")
        with self.assertRaises(AuthError):
            self.auth.consume_state(state, "browser-b")
        self.assertIsNone(self.auth.consume_state(state, "browser-a"))
        with self.assertRaises(AuthError):
            self.auth.consume_state(state, "browser-a")
        expired = self.auth.create_state("browser-a", ttl=-1)
        with self.assertRaises(AuthError):
            self.auth.consume_state(expired, "browser-a")

    def test_session_expiry_revocation_and_rotation(self):
        first, csrf = self.auth.create_session("1001")
        self.assertTrue(self.auth.check_csrf(self.auth.session(first), csrf))
        second, _ = self.auth.create_session("1001", first)
        self.assertIsNone(self.auth.session(first))
        self.assertIsNotNone(self.auth.session(second))
        self.auth.revoke_session(second)
        self.assertIsNone(self.auth.session(second))
        expired, _ = self.auth.create_session("1001")
        with self.auth.connect() as db:
            db.execute("UPDATE web_session SET expires_at=?", (int(time.time()) - 1,))
        self.assertIsNone(self.auth.session(expired))

    def test_invitation_is_player_only_single_use_expiring_and_revocable(self):
        campaign = self.auth.create_campaign("1001", "Dungeon")
        dm = self.auth.authorize("1001", campaign["id"])
        token = self.auth.create_invite(dm)
        campaign_id = self.auth.accept_invite(token, "2002", "Player")
        self.assertEqual(campaign["id"], campaign_id)
        self.assertEqual("player", self.auth.authorize("2002", campaign_id)["role"])
        with self.assertRaises(AuthError):
            self.auth.accept_invite(token, "2002", "Player")
        second = self.auth.create_invite(dm)
        invite_hash = digest(second)
        self.assertTrue(self.auth.revoke_invite(dm, invite_hash))
        with self.assertRaises(AuthError):
            self.auth.accept_invite(second, "2002", "Player")
        expired = self.auth.create_invite(dm, expires_in=-1)
        with self.assertRaises(AuthError):
            self.auth.accept_invite(expired, "2002", "Player")
        dm_invite = self.auth.create_invite(dm)
        with self.assertRaises(AuthError):
            self.auth.accept_invite(dm_invite, "1001", "DM")

    def test_verified_legacy_ids_become_memberships_without_name_matching(self):
        campaign = self.service.store.create_campaign("legacy", "Legacy", "1001", "mothership")
        self.service.store.create_or_rotate_player("legacy", "2002", "Different Display Name", "mothership")
        roles = {item["id"]: item["role"] for item in self.auth.memberships("1001")}
        self.assertEqual("warden", roles[campaign["id"]])
        self.assertEqual("player", self.auth.memberships("2002")[0]["role"])
        self.assertEqual([], self.auth.memberships("9999"))

    def test_campaign_isolation_and_role_enforcement(self):
        first = self.auth.create_campaign("1001", "First")
        second = self.auth.create_campaign("2002", "Second")
        self.assertIsNone(self.auth.authorize("2002", first["id"]))
        self.assertIsNone(self.auth.authorize("1001", second["id"]))
        with self.assertRaises(AuthError):
            self.auth.create_invite({"role": "player", "campaign_id": first["id"], "discord_user_id": "2002"})


class WebAuthHttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.service = Companion(None, str(root / "companion.db"), str(root / "assets"), oauth_config={
            "client_id": "client", "client_secret": "secret",
            "redirect_uri": "http://localhost/auth/discord/callback",
            "public_url": "http://localhost", "cookie_secure": False,
        })
        self.client = TestClient(TestServer(self.service.create_web_app()))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        self.temp.cleanup()

    def login_cookie(self, user_id="1001"):
        self.service.web_auth.upsert_identity({"id": user_id, "username": f"user-{user_id}"})
        session, csrf = self.service.web_auth.create_session(user_id)
        self.client.session.cookie_jar.update_cookies({"dm_session": session, "dm_csrf": csrf})
        return csrf

    async def test_csrf_required_for_mutation_and_logout_revokes_session(self):
        csrf = self.login_cookie()
        denied = await self.client.post("/api/campaigns", json={"name": "No CSRF"})
        self.assertEqual(403, denied.status)
        created = await self.client.post("/api/campaigns", json={"name": "Allowed"}, headers={"X-CSRF-Token": csrf})
        self.assertEqual(201, created.status)
        logged_out = await self.client.post("/api/auth/logout", json={}, headers={"X-CSRF-Token": csrf})
        self.assertEqual(200, logged_out.status)
        self.assertEqual(401, (await self.client.get("/api/auth/me")).status)

    async def test_oauth_callback_validates_state_and_rotates_session(self):
        async def exchange(code):
            self.assertEqual("code", code)
            return {"access_token": "temporary", "scope": "identify"}
        async def identity(_token):
            return {"id": "3003", "username": "new-user", "global_name": "New User"}
        self.service.exchange_discord_code = exchange
        self.service.fetch_discord_identity = identity
        begin = await self.client.post("/api/auth/begin", json={})
        self.assertEqual(200, begin.status)
        state = (await begin.json())["authorize_url"].split("state=", 1)[1]
        callback = await self.client.get(f"/auth/discord/callback?code=code&state={state}", allow_redirects=False)
        self.assertEqual(302, callback.status)
        self.assertEqual(200, (await self.client.get("/api/auth/me")).status)
        replay = await self.client.get(f"/auth/discord/callback?code=code&state={state}", allow_redirects=False)
        self.assertEqual("/?auth=failed", replay.headers["Location"])

    async def test_cross_campaign_selection_is_forbidden(self):
        csrf = self.login_cookie("1001")
        other = self.service.web_auth.create_campaign("2002", "Private")
        response = await self.client.post("/api/campaigns/select", json={"campaign_id": other["id"]},
                                          headers={"X-CSRF-Token": csrf})
        self.assertEqual(403, response.status)


if __name__ == "__main__":
    unittest.main()
