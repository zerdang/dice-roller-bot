import tempfile
import unittest
from pathlib import Path

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from cogs.reference_api import ReferenceApi
from functions.dnd import DndError
from functions.reference import ReferenceStore, identity, normalize, plain


def documents():
    return [{"class": [
        {"name": "Fighter", "source": "PHB", "entries": ["Original martial training."]},
        {"name": "Fighter", "source": "XPHB", "entries": ["Revised martial training."]},
    ], "background": [
        {"name": "Invented Scholar", "source": "TEST", "entries": ["Study an {@item Example Tome|TEST}."], "ability": [{"int": 2}]},
        {"name": "Invented Apprentice", "source": "TEST", "_copy": {"name": "Invented Scholar", "source": "TEST"}},
        {"name": "Invented Alteration", "source": "TEST", "_copy": {"name": "Invented Scholar", "source": "TEST", "_mod": {"entries": {"mode": "unknown"}}}},
    ], "race": [{"name": "Example Folk", "source": "TEST", "entries": ["Example trait."]}],
        "subrace": [{"raceName": "Example Folk", "raceSource": "TEST", "source": "TEST"}],
        "adventure": [{"name": "Secret adventure", "source": "TEST", "entries": ["Spoiler text"]}]}]


class ReferenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = ReferenceStore(Path(self.temp.name) / "reference.db")
        self.version = "a" * 40
        self.report = self.store.import_documents(self.version, documents())
        self.player = {"role": "player", "campaign_id": 1, "game_system": "dnd"}
        self.dm = {**self.player, "role": "warden"}

    def tearDown(self):
        self.temp.cleanup()

    def test_full_sources_editions_and_subrace_are_preserved(self):
        self.assertEqual(7, self.report["total"])
        result = self.store.search(self.player, "Fighter")
        self.assertEqual(2, result["total"])
        self.assertEqual({"2014", "2024"}, {r["edition"] for r in result["items"]})
        self.assertNotEqual(result["items"][0]["id"], result["items"][1]["id"])
        self.assertEqual(1, self.store.search(self.player, kind="subrace")["total"])
        self.assertEqual(0, self.store.search(self.player, "Spoiler")["total"])

    def test_inheritance_and_unsupported_mods_are_explicit(self):
        found = self.store.search(self.player, "Invented Apprentice")["items"][0]
        detail = self.store.detail(self.player, found["id"])
        self.assertIn("Study an Example Tome", detail["text"])
        modified = self.store.search(self.player, "Invented Alteration")["items"][0]
        detail = self.store.detail(self.player, modified["id"])
        self.assertTrue(detail["warnings"])
        self.assertNotIn("Study an Example Tome", detail["text"])
        self.assertEqual("reference_only", detail["creation_support"])

    def test_source_policy_applies_to_search_detail_and_metadata(self):
        hidden = self.store.search(self.player, source="TEST")["items"][0]
        self.store.set_policy(self.dm, ["XPHB"])
        self.assertEqual(1, self.store.search(self.player)["total"])
        self.assertEqual(["XPHB"], self.store.metadata(self.player)["sources"])
        self.assertNotIn("all_sources", self.store.metadata(self.player))
        with self.assertRaises(DndError) as caught:
            self.store.detail(self.player, hidden["id"], self.version)
        self.assertEqual(404, caught.exception.status)
        other = {**self.player, "campaign_id": 2}
        self.assertEqual(7, self.store.search(other)["total"])
        with self.assertRaises(DndError):
            self.store.set_policy(self.player, None)
        self.store.set_policy(self.dm, [])
        self.assertEqual(0, self.store.search(self.player)["total"])
        self.store.set_policy(self.dm, None)
        self.assertEqual(7, self.store.search(self.player)["total"])

    def test_version_pin_and_failed_import_leave_catalog_intact(self):
        old = self.store.search(self.player, "Fighter")["items"][0]
        with self.assertRaises(ValueError):
            self.store.import_documents("b" * 40, [{"class": [{"source": "TEST"}]}])
        self.assertEqual(self.version, self.store.metadata(self.player)["version"])
        self.store.import_documents("b" * 40, [{"class": [{"name": "New", "source": "TEST"}]}])
        self.assertEqual(1, self.store.search(self.player)["total"])
        self.assertEqual("Fighter", self.store.detail(self.player, old["id"], self.version)["name"])
        self.store.import_documents(self.version, documents())
        self.assertEqual("b" * 40, self.store.metadata(self.player)["version"])

    def test_input_bounds_and_fts_syntax_are_safe(self):
        # OR is searched as a literal prefix ("Original"), never a query operator.
        self.assertEqual(1, self.store.search(self.player, '" OR * --')["total"])
        self.assertEqual(0, self.store.search(self.player, '" * --')["total"])
        self.assertEqual(2, self.store.search(self.player, "fight")["total"])
        self.assertEqual(1, len(self.store.search(self.player, limit=1, offset=1)["items"]))
        for kwargs in ({"query": "x" * 201}, {"offset": -1}, {"limit": 101}):
            with self.assertRaises(DndError):
                self.store.search(self.player, **kwargs)
        for auth in ({}, {**self.player, "game_system": "mothership"}):
            with self.assertRaises(DndError):
                self.store.search(auth)

    def test_variants_cycles_and_plain_tables(self):
        entries, _ = normalize([{"race": [
            {"name": "Cycle A", "source": "TEST", "_copy": {"name": "Cycle B", "source": "TEST"}},
            {"name": "Cycle B", "source": "TEST", "_copy": {"name": "Cycle A", "source": "TEST"}},
            {"name": "Base", "source": "TEST", "_versions": [{"_abstract": {"name": "Base ({{color}})"}, "_implementations": [{"_variables": {"color": "Blue"}}]}]},
        ]}])
        self.assertEqual(4, len(entries))
        self.assertTrue(entries[0]["warnings"])
        self.assertIn("Base (Blue)", [e["name"] for e in entries])
        self.assertEqual("Roll\n1\nExample", plain({"colLabels": ["Roll"], "rows": [[1, "Example"]]}))


class ReferenceApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = ReferenceStore(Path(self.temp.name) / "reference.db")
        self.store.import_documents("a" * 40, documents())
        def auth(request):
            if not request.headers.get("Test-Role"):
                raise web.HTTPUnauthorized()
            return {"role": request.headers["Test-Role"], "campaign_id": 1, "game_system": "dnd"}
        app = web.Application()
        ReferenceApi(self.store, auth).register(app)
        self.client = TestClient(TestServer(app))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        self.temp.cleanup()

    async def test_authenticated_search_and_dm_policy(self):
        self.assertEqual(401, (await self.client.get("/api/dnd/reference")).status)
        headers = {"Test-Role": "player"}
        result = await self.client.get("/api/dnd/reference?q=Fighter", headers=headers)
        self.assertEqual(2, (await result.json())["total"])
        denied = await self.client.put("/api/dnd/reference/policy", headers=headers, json={"sources": []})
        self.assertEqual(403, denied.status)
        updated = await self.client.put("/api/dnd/reference/policy", headers={"Test-Role": "warden"}, json={"sources": []})
        self.assertEqual(0, (await updated.json())["total"])
        result = await self.client.get("/api/dnd/reference?offset=bad", headers=headers)
        self.assertEqual(400, result.status)


if __name__ == "__main__":
    unittest.main()
