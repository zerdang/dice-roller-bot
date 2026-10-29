import tempfile
import unittest
import sqlite3
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from functions.companion import CompanionStore


class CompanionStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.store = CompanionStore(str(Path(self.temp_dir.name) / "companion.db"))
        self.campaign = self.store.create_campaign("guild-1", "The Ash Vault", "owner-1")
        self.warden_token = self.store.rotate_warden_token("guild-1", "owner-1")
        created = self.store.create_or_rotate_player("guild-1", "user-1", "Mara")
        self.character, self.player_token = created

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_player_dashboard_hides_warden_fields(self):
        player = self.store.authorize(self.player_token)
        dashboard = self.store.dashboard(player)
        self.assertEqual("player", dashboard["role"])
        self.assertEqual(1, len(dashboard["characters"]))
        self.assertNotIn("warden_notes", dashboard["characters"][0])
        self.assertNotIn("player_token_hash", dashboard["characters"][0])

    def test_player_cannot_edit_another_character(self):
        other, _token = self.store.create_or_rotate_player("guild-1", "user-2", "Bram")
        player = self.store.authorize(self.player_token)
        self.assertFalse(self.store.update_character(player, other["id"], {"hp": 1}))

    def test_warden_can_edit_private_notes(self):
        warden = self.store.authorize(self.warden_token)
        self.assertTrue(self.store.update_character(
            warden, self.character["id"], {"warden_notes": "Carries the marked key"}
        ))
        dashboard = self.store.dashboard(warden)
        self.assertEqual("Carries the marked key", dashboard["characters"][0]["warden_notes"])

    def test_character_resources_and_class_are_bounded_and_persisted(self):
        player = self.store.authorize(self.player_token)
        self.assertTrue(self.store.update_character(player, self.character["id"], {
            "stress": 1, "resolve": 12, "hp": -3, "max_hp": 0,
            "wounds": 8, "max_wounds": 3, "class_name": "Teamster",
        }))
        character = self.store.dashboard(player)["characters"][0]
        self.assertEqual(2, character["stress"])
        self.assertEqual(5, character["resolve"])
        self.assertEqual(0, character["hp"])
        self.assertEqual(1, character["max_hp"])
        self.assertEqual(3, character["wounds"])
        self.assertEqual(3, character["max_wounds"])
        self.assertEqual("teamster", character["class_name"])

    def test_character_skills_are_bounded_and_persisted(self):
        player = self.store.authorize(self.player_token)
        skills = ["computers", "hacking", "artificial-intelligence"]
        self.assertTrue(self.store.update_character(player, self.character["id"], {"skills": skills}))
        self.assertEqual(skills, self.store.dashboard(player)["characters"][0]["skills"])

    def test_only_campaign_owner_can_issue_warden_link(self):
        self.assertIsNone(self.store.rotate_warden_token("guild-1", "intruder"))
        self.assertIsNotNone(self.store.authorize(self.warden_token))
        replacement = self.store.rotate_warden_token("guild-1", "owner-1")
        self.assertIsNotNone(replacement)
        self.assertIsNone(self.store.authorize(self.warden_token))
        self.assertEqual("warden", self.store.authorize(replacement)["role"])

    def test_another_admin_cannot_take_over_existing_campaign(self):
        self.assertIsNone(self.store.create_campaign("guild-1", "Hijacked", "intruder"))
        self.assertTrue(self.store.is_campaign_owner("guild-1", "owner-1"))
        self.assertFalse(self.store.is_campaign_owner("guild-1", "intruder"))
        self.assertEqual("The Ash Vault", self.store.dashboard(self.store.authorize(self.warden_token))["campaign"]["name"])

    def test_claiming_legacy_campaign_revokes_its_old_warden_link(self):
        with self.store.connect() as db:
            db.execute("UPDATE campaign SET owner_discord_user_id = NULL WHERE guild_id = 'guild-1'")
        claimed = self.store.create_campaign("guild-1", "The Ash Vault", "new-owner")
        self.assertEqual("new-owner", claimed["owner_discord_user_id"])
        self.assertIsNone(self.store.authorize(self.warden_token))

    def test_inventory_and_roll_feed(self):
        player = self.store.authorize(self.player_token)
        item_id = self.store.add_item(player, self.character["id"], {
            "name": "Notched sword", "kind": "weapon", "details": "d8 damage"
        })
        self.assertIsInstance(item_id, int)
        self.assertTrue(self.store.record_roll("guild-1", "user-1", "Mara", "d20+2", "17"))
        dashboard = self.store.dashboard(player)
        self.assertEqual("Notched sword", dashboard["characters"][0]["inventory"][0]["name"])
        self.assertEqual("d20+2", dashboard["rolls"][0]["expression"])

    def test_mothership_inventory_fields_update_and_round_trip(self):
        player = self.store.authorize(self.player_token)
        item_id = self.store.add_item(player, self.character["id"], {
            "catalog_key": "service-pistol", "name": "Service Pistol", "kind": "weapon", "damage": "3d10 DMG",
            "range_band": "20/100", "wound": "Gunshot", "shots": "6",
            "ammo": 5, "ammo_max": 6, "special": "Loud", "cost": 400,
        })
        self.assertTrue(self.store.update_item(player, item_id, {"ammo": 4, "equipped": True}))
        item = self.store.dashboard(player)["characters"][0]["inventory"][0]
        self.assertEqual("3d10 DMG", item["damage"])
        self.assertEqual("service-pistol", item["catalog_key"])
        self.assertEqual("20/100", item["range_band"])
        self.assertEqual(4, item["ammo"])
        self.assertEqual(1, item["equipped"])

    def test_player_cannot_update_another_players_item(self):
        other, _token = self.store.create_or_rotate_player("guild-1", "user-2", "Bram")
        warden = self.store.authorize(self.warden_token)
        item_id = self.store.add_item(warden, other["id"], {"name": "Restricted"})
        player = self.store.authorize(self.player_token)
        self.assertFalse(self.store.update_item(player, item_id, {"name": "Stolen"}))

    def test_manual_inventory_order_survives_database_round_trip(self):
        player = self.store.authorize(self.player_token)
        first = self.store.add_item(player, self.character["id"], {"name": "First"})
        second = self.store.add_item(player, self.character["id"], {"name": "Second"})
        third = self.store.add_item(player, self.character["id"], {"name": "Third"})
        self.assertTrue(self.store.reorder_items(player, self.character["id"], [third, first, second]))
        inventory = self.store.dashboard(player)["characters"][0]["inventory"]
        self.assertEqual([third, first, second], [item["id"] for item in inventory])

    def test_legacy_inventory_schema_is_migrated_without_data_loss(self):
        legacy_path = Path(self.temp_dir.name) / "legacy.db"
        with closing(sqlite3.connect(legacy_path)) as db:
            db.executescript("""
                CREATE TABLE inventory_item (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, character_id INTEGER NOT NULL,
                    name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'item',
                    quantity INTEGER NOT NULL DEFAULT 1, details TEXT NOT NULL DEFAULT '',
                    equipped INTEGER NOT NULL DEFAULT 0
                );
                INSERT INTO inventory_item(character_id, name) VALUES (99, 'Legacy torch');
            """)
            db.commit()
        CompanionStore(str(legacy_path))
        with closing(sqlite3.connect(legacy_path)) as db:
            db.row_factory = sqlite3.Row
            row = db.execute("SELECT * FROM inventory_item").fetchone()
        self.assertEqual("Legacy torch", row["name"])
        self.assertEqual("", row["damage"])
        self.assertEqual(row["id"], row["position"])

    def test_legacy_character_schema_receives_resource_and_class_defaults(self):
        legacy_path = Path(self.temp_dir.name) / "legacy-character.db"
        with closing(sqlite3.connect(legacy_path)) as db:
            db.executescript("""
                CREATE TABLE campaign (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL UNIQUE,
                    name TEXT NOT NULL, warden_token_hash TEXT NOT NULL, created_at TEXT NOT NULL
                );
                CREATE TABLE character (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id INTEGER NOT NULL,
                    discord_user_id TEXT, name TEXT NOT NULL, player_token_hash TEXT NOT NULL UNIQUE,
                    hp INTEGER NOT NULL DEFAULT 10, max_hp INTEGER NOT NULL DEFAULT 10,
                    stats_json TEXT NOT NULL DEFAULT '{}', public_notes TEXT NOT NULL DEFAULT '',
                    warden_notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
                );
                INSERT INTO campaign(guild_id, name, warden_token_hash, created_at)
                    VALUES ('legacy-guild', 'Legacy', 'hash', 'now');
                INSERT INTO character(campaign_id, name, player_token_hash, created_at)
                    VALUES (1, 'Legacy Crew', 'player-hash', 'now');
            """)
            db.commit()
        CompanionStore(str(legacy_path))
        with closing(sqlite3.connect(legacy_path)) as db:
            db.row_factory = sqlite3.Row
            row = db.execute("SELECT * FROM character").fetchone()
        self.assertEqual("Legacy Crew", row["name"])
        self.assertEqual(2, row["stress"])
        self.assertEqual(0, row["resolve"])
        self.assertEqual(0, row["wounds"])
        self.assertEqual(2, row["max_wounds"])
        self.assertEqual("", row["class_name"])

    def test_rotating_link_invalidates_the_old_token(self):
        old_token = self.player_token
        _character, new_token = self.store.create_or_rotate_player("guild-1", "user-1", "Mara")
        self.assertIsNone(self.store.authorize(old_token))
        self.assertIsNotNone(self.store.authorize(new_token))

    def test_stat_manual_order_survives_database_round_trip(self):
        player = self.store.authorize(self.player_token)
        ordered_stats = {"Sanity": "64", "Combat": "36", "Strength": "42"}
        self.assertTrue(self.store.update_character(
            player, self.character["id"], {"stats": ordered_stats}
        ))
        saved_stats = self.store.dashboard(player)["characters"][0]["stats"]
        self.assertEqual(list(ordered_stats), list(saved_stats))

    @patch("functions.companion.secrets.randbelow", return_value=21)
    def test_player_can_roll_saved_stat_and_record_it_in_feed(self, _random):
        player = self.store.authorize(self.player_token)
        self.store.update_character(player, self.character["id"], {"stats": {"Strength": 44}})
        result = self.store.roll_character_stat(player, self.character["id"], "strength")
        self.assertEqual(22, result["roll"])
        self.assertEqual(44, result["target"])
        self.assertTrue(result["success"])
        self.assertTrue(result["critical"])
        self.assertEqual("CRITICAL SUCCESS", result["outcome"])
        roll = self.store.dashboard(player)["rolls"][0]
        self.assertEqual("Strength check [44]", roll["expression"])
        self.assertIn("CRITICAL SUCCESS", roll["result"])

    @patch("functions.companion.secrets.randbelow", side_effect=[2, 6, 9])
    def test_player_can_roll_weapon_damage_and_record_it_in_feed(self, _random):
        player = self.store.authorize(self.player_token)
        item_id = self.store.add_item(player, self.character["id"], {
            "name": "FN Slug Gun Revolver", "kind": "weapon", "damage": "3d10",
        })
        result = self.store.roll_weapon_damage(player, self.character["id"], item_id)
        self.assertEqual([3, 7, 10], result["dice"])
        self.assertEqual(20, result["total"])
        self.assertEqual("3d10", result["expression"])
        roll = self.store.dashboard(player)["rolls"][0]
        self.assertEqual("FN Slug Gun Revolver damage [3d10]", roll["expression"])
        self.assertIn("TOTAL 20", roll["result"])

    def test_non_damage_weapon_cannot_make_damage_roll(self):
        player = self.store.authorize(self.player_token)
        item_id = self.store.add_item(player, self.character["id"], {
            "name": "D&C 7 Tranquilizer Pistol", "kind": "weapon", "damage": "N/A",
        })
        with self.assertRaises(ValueError):
            self.store.roll_weapon_damage(player, self.character["id"], item_id)

    def test_player_cannot_roll_another_players_character(self):
        other, _token = self.store.create_or_rotate_player("guild-1", "user-2", "Bram")
        player = self.store.authorize(self.player_token)
        self.assertIsNone(self.store.roll_character_stat(player, other["id"], "Combat"))

    def test_turn_order_contains_crew_and_warden_managed_enemies(self):
        player = self.store.authorize(self.player_token)
        warden = self.store.authorize(self.warden_token)
        crew_entry = self.store.dashboard(player)["turn_order"][0]
        enemy_id = self.store.add_enemy(warden, "Hull Creeper")
        self.assertIsNone(self.store.add_enemy(player, "Spoofed Enemy"))
        self.assertTrue(self.store.reorder_turns(warden, [enemy_id, crew_entry["id"]]))
        order = self.store.dashboard(player)["turn_order"]
        self.assertEqual(["Hull Creeper", "Mara"], [entry["name"] for entry in order])
        self.assertFalse(self.store.delete_enemy(player, enemy_id))
        self.assertTrue(self.store.delete_enemy(warden, enemy_id))

    def test_only_warden_can_change_map_visibility(self):
        player = self.store.authorize(self.player_token)
        warden = self.store.authorize(self.warden_token)
        self.assertFalse(self.store.update_map_visibility(player, {"garage": True}))
        self.assertTrue(self.store.update_map_visibility(warden, {"garage": True, "not-a-zone": True}))
        self.assertEqual({"garage": True}, self.store.dashboard(player)["map_visibility"])

    @patch("functions.companion.secrets.randbelow", side_effect=[98, 4])
    def test_failed_double_adds_stress_and_makes_panic_check(self, _random):
        player = self.store.authorize(self.player_token)
        self.store.update_character(player, self.character["id"], {"stats": {"Fear": 30}, "stress": 4})
        result = self.store.roll_character_stat(player, self.character["id"], "Fear")
        self.assertEqual(99, result["roll"])
        self.assertEqual(5, result["stress_after"])
        self.assertEqual(5, result["panic_roll"])
        self.assertTrue(result["panic_failed"])
        self.assertEqual(5, self.store.dashboard(player)["characters"][0]["stress"])

    @patch("functions.companion.secrets.randbelow", side_effect=[76, 10])
    def test_advantage_keeps_critical_success_over_lower_normal_success(self, _random):
        player = self.store.authorize(self.player_token)
        self.store.update_character(player, self.character["id"], {
            "stats": {"Intellect": 40}, "skills": ["computers"],
        })
        result = self.store.roll_character_stat(
            player, self.character["id"], "Intellect", "computers", "advantage"
        )
        self.assertEqual(50, result["target"])
        self.assertEqual([77, 11], result["rolls"])
        self.assertEqual(11, result["roll"])
        self.assertEqual("CRITICAL SUCCESS", result["outcome"])

    @patch("functions.companion.secrets.randbelow", return_value=89)
    def test_stress_over_twenty_reduces_relevant_stat(self, _random):
        player = self.store.authorize(self.player_token)
        self.store.update_character(player, self.character["id"], {"stats": {"Combat": 35}, "stress": 20})
        result = self.store.roll_character_stat(player, self.character["id"], "Combat")
        self.assertEqual(1, result["stat_loss"])
        character = self.store.dashboard(player)["characters"][0]
        self.assertEqual(20, character["stress"])
        self.assertEqual(34, character["stats"]["Combat"])


if __name__ == "__main__":
    unittest.main()
