import sqlite3
import struct
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from functions.battlemap import BattlemapStore, MapError
from functions.companion import CompanionStore


class BattlemapTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.temp.name) / "companion.db")
        self.companion = CompanionStore(self.path)
        self.companion.create_campaign("guild", "Dungeon", "dm", "dnd")
        self.warden_token = self.companion.rotate_warden_token("guild", "dm", "dnd")
        self.first, self.first_token = self.companion.create_or_rotate_player("guild", "p1", "Ada", "dnd")
        self.second, self.second_token = self.companion.create_or_rotate_player("guild", "p2", "Bo", "dnd")
        self.warden = self.companion.authorize(self.warden_token)
        self.player = self.companion.authorize(self.first_token)
        self.other = self.companion.authorize(self.second_token)
        self.maps = BattlemapStore(self.path, Path(self.temp.name) / "assets")
        self.scene = self.maps.create_scene(self.warden, {"name": "Vault", "width": 1200, "height": 800})

    def tearDown(self):
        self.temp.cleanup()

    def test_same_guild_can_hold_separate_game_campaigns(self):
        mothership = self.companion.create_campaign("guild", "Derelict", "dm", "mothership")
        self.assertNotEqual(self.warden["campaign_id"], mothership["id"])
        self.assertEqual("dnd", self.companion.dashboard(self.warden)["campaign"]["game_system"])

    def test_mothership_cannot_open_dnd_battlemap(self):
        self.companion.create_campaign("other", "Legacy", "dm2", "mothership")
        token = self.companion.rotate_warden_token("other", "dm2", "mothership")
        with self.assertRaises(MapError) as caught:
            self.maps.list_scenes(self.companion.authorize(token))
        self.assertEqual(403, caught.exception.status)

    def test_player_sees_only_active_scene(self):
        private_scene = self.maps.create_scene(self.warden, {"name": "Secret"})
        self.assertEqual([self.scene["id"]], [item["id"] for item in self.maps.list_scenes(self.player)])
        with self.assertRaises(MapError):
            self.maps.snapshot(self.player, private_scene["id"])

    def test_token_ownership_lock_visibility_and_stale_revision(self):
        token = self.maps.create_token(self.warden, self.scene["id"], {
            "name": "Ada", "owners": [self.first["id"]], "x": 10, "y": 20,
            "counters": [{"key": "ammo", "label": "Ammo", "value": 6},
                         {"key": "hp", "label": "HP", "value": 8, "private": True}],
        })
        moved = self.maps.update_token(self.player, token["id"], {"revision": 1, "x": 30, "y": 40})
        self.assertEqual(2, moved["revision"])
        with self.assertRaises(MapError) as stale:
            self.maps.update_token(self.player, token["id"], {"revision": 1, "x": 99})
        self.assertEqual(409, stale.exception.status)
        with self.assertRaises(MapError):
            self.maps.update_token(self.other, token["id"], {"revision": 2, "x": 99})
        public = self.maps.snapshot(self.player)["tokens"][0]
        self.assertEqual(["ammo"], [item["key"] for item in public["counters"]])
        hidden = self.maps.update_token(self.warden, token["id"], {"revision": 2, "hidden": True})
        self.assertTrue(hidden["hidden"])
        self.assertEqual([], self.maps.snapshot(self.player)["tokens"])

    def test_atomic_counter_delta_obeys_bounds(self):
        token = self.maps.create_token(self.warden, self.scene["id"], {
            "name": "Ada", "owners": [self.first["id"]],
            "counters": [{"key": "ammo", "label": "Ammo", "value": 1, "min": 0, "max": 2}],
        })
        value = self.maps.counter_delta(self.player, token["id"], "ammo", 5, 1)
        self.assertEqual(2, value["counters"][0]["value"])
        value = self.maps.counter_delta(self.player, token["id"], "ammo", -9, 2)
        self.assertEqual(0, value["counters"][0]["value"])

    def test_counter_retries_are_idempotent_and_stale_deltas_accumulate(self):
        token = self.maps.create_token(self.warden, self.scene["id"], {
            "name": "Shared", "owners": [self.first["id"], self.second["id"]],
            "counters": [{"key": "round", "label": "Round", "value": 0}],
        })
        first = self.maps.counter_delta(self.player, token["id"], "round", 1, 1, "p1-one")
        duplicate = self.maps.counter_delta(self.player, token["id"], "round", 1, 1, "p1-one")
        second = self.maps.counter_delta(self.other, token["id"], "round", 1, 1, "p2-one")
        self.assertEqual(1, first["counters"][0]["value"])
        self.assertEqual(1, duplicate["counters"][0]["value"])
        self.assertEqual(2, second["counters"][0]["value"])

    def test_undo_refuses_to_overwrite_an_intervening_edit(self):
        token = self.maps.create_token(self.warden, self.scene["id"], {
            "name": "Shared", "owners": [self.first["id"], self.second["id"]],
        })
        first = self.maps.update_token(self.player, token["id"], {"revision": 1, "x": 200})
        self.maps.update_token(self.other, token["id"], {"revision": first["revision"], "x": 300})
        with self.assertRaises(MapError) as conflict:
            self.maps.undo(self.player)
        self.assertEqual(409, conflict.exception.status)

    def test_annotation_geometry_is_world_data(self):
        item = self.maps.create_annotation(self.player, self.scene["id"], {
            "kind": "cone", "label": "Breath", "geometry": {"x": 20, "y": 30, "radius": 60, "angle": 45, "rotation": 90}
        })
        self.assertEqual(60.0, item["geometry"]["radius"])
        self.assertEqual(self.first["id"], item["creator_character_id"])

    def test_asset_is_validated_and_inactive_asset_is_private(self):
        png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 8 + struct.pack(">II", 320, 200) + b"fixture"
        asset = self.maps.store_asset(self.warden, "room.png", png)
        private_scene = self.maps.create_scene(self.warden, {"name": "Private"})
        updated = self.maps.update_scene(self.warden, private_scene["id"], {"revision": 1, "asset_id": asset["id"], "width": 320, "height": 200})
        self.assertEqual(asset["id"], updated["asset_id"])
        with self.assertRaises(MapError) as private:
            self.maps.asset(self.player, asset["id"])
        self.assertEqual(404, private.exception.status)
        activated = self.maps.update_scene(self.warden, private_scene["id"], {"revision": updated["revision"], "activate": True})
        self.assertTrue(activated["is_active"])
        path, media_type = self.maps.asset(self.player, asset["id"])
        self.assertTrue(path.is_file())
        self.assertEqual("image/png", media_type)

    def test_rejects_invalid_image(self):
        with self.assertRaises(MapError):
            self.maps.store_asset(self.warden, "not-map.txt", b"not an image")


class GameMigrationTests(unittest.TestCase):
    def test_legacy_campaign_backfills_to_mothership_and_allows_dnd_peer(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "legacy.db"
            with closing(sqlite3.connect(path)) as db:
                db.execute("CREATE TABLE campaign(id INTEGER PRIMARY KEY, guild_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, warden_token_hash TEXT NOT NULL, created_at TEXT NOT NULL)")
                db.execute("INSERT INTO campaign VALUES(1,'g','Legacy','hash','now')")
                db.commit()
            store = CompanionStore(str(path))
            with store.connect() as db:
                legacy = db.execute("SELECT * FROM campaign WHERE id=1").fetchone()
            self.assertEqual("mothership", legacy["game_system"])
            created = store.create_campaign("g", "New Dungeon", "owner", "dnd")
            self.assertEqual("dnd", created["game_system"])


if __name__ == "__main__":
    unittest.main()
