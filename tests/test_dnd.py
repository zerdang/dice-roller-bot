import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from functions.battlemap import BattlemapStore
from functions.companion import CompanionStore
from functions.dnd import DndError, DndStore


class DndReleaseOneTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.temp.name) / "companion.db")
        self.companion = CompanionStore(self.path)
        self.companion.create_campaign("guild", "2024 game", "dm", "dnd")
        dm_token = self.companion.rotate_warden_token("guild", "dm", "dnd")
        self.first, first_token = self.companion.create_or_rotate_player("guild", "p1", "Ada", "dnd")
        self.second, second_token = self.companion.create_or_rotate_player("guild", "p2", "Bo", "dnd")
        self.dm = self.companion.authorize(dm_token)
        self.player = self.companion.authorize(first_token)
        self.other = self.companion.authorize(second_token)
        self.store = DndStore(self.path)

    def tearDown(self):
        self.temp.cleanup()

    def test_profiles_are_dnd_only_and_player_cannot_edit_another_card(self):
        self.assertEqual("dnd_2024", self.store.cards(self.player)[0]["ruleset"])
        with self.assertRaises(DndError) as caught:
            self.store.update_card(self.player, self.second["id"], {"revision": 1, "armor_class": 20})
        self.assertEqual(403, caught.exception.status)

    def test_card_persists_manual_fields_and_canonical_hp(self):
        card = self.store.update_card(self.player, self.first["id"], {
            "revision": 1, "hp": 7, "max_hp": 18, "temp_hp": 4, "armor_class": 16,
            "abilities": {"strength": 3}, "spell_slots": {"1": {"current": 2, "max": 4}},
            "resources": [{"name": "Ki", "current": 2, "max": 3}],
            "features": [{"name": "Cleave", "uses": 1, "notes": "Manual mastery reminder"}],
        })
        self.assertEqual((7, 18, 4, 16), (card["hp"], card["max_hp"], card["temp_hp"], card["armor_class"]))
        self.assertEqual("Ki", self.store.cards(self.player)[0]["resources"][0]["name"])

    def test_resource_delta_is_bounded_atomic_and_idempotent(self):
        first = self.store.resource_delta(self.player, self.first["id"], {
            "field": "death_failures", "delta": 9, "operation_id": "failure-once",
        })
        duplicate = self.store.resource_delta(self.player, self.first["id"], {
            "field": "death_failures", "delta": 9, "operation_id": "failure-once",
        })
        self.assertEqual(3, first["death_failures"])
        self.assertEqual(first, duplicate)

    @patch("functions.dnd.secrets.randbelow", side_effect=[4, 18, 15, 2])
    def test_advantage_and_disadvantage_select_one_d20(self, _random):
        advantage = self.store.roll(self.player, self.first["id"], {
            "kind": "skill", "label": "Stealth", "expression": "1d20+3",
            "mode": "advantage", "audience": "public", "operation_id": "adv",
        })
        disadvantage = self.store.roll(self.player, self.first["id"], {
            "kind": "save", "label": "Wisdom", "expression": "1d20-1",
            "mode": "disadvantage", "audience": "public", "operation_id": "dis",
        })
        self.assertEqual(([5, 19], [19], 22), (advantage["dice"], advantage["selected"], advantage["total"]))
        self.assertEqual(([16, 3], [3], 2), (disadvantage["dice"], disadvantage["selected"], disadvantage["total"]))

    def test_expression_complexity_and_dm_audience_are_rejected(self):
        for expression in ("51d6", "1d1", "2d6+3d4", "hello"):
            with self.assertRaises(DndError):
                self.store.roll(self.player, self.first["id"], {"expression": expression, "operation_id": expression})
        with self.assertRaises(DndError) as caught:
            self.store.roll(self.player, self.first["id"], {"expression": "1d20", "audience": "dm", "operation_id": "dm"})
        self.assertEqual(403, caught.exception.status)

    @patch("functions.dnd.secrets.randbelow", side_effect=[9, 13])
    def test_inspiration_reroll_is_linked_and_idempotent(self, _random):
        original = self.store.roll(self.player, self.first["id"], {"expression": "1d20+2", "operation_id": "original"})
        card = self.store.cards(self.player)[0]
        self.store.update_card(self.player, self.first["id"], {"revision": card["revision"], "heroic_inspiration": 1})
        request = {"expression": "1d20+2", "parent_roll_id": original["id"], "operation_id": "reroll"}
        reroll = self.store.roll(self.player, self.first["id"], request)
        duplicate = self.store.roll(self.player, self.first["id"], request)
        self.assertEqual(original["id"], reroll["parent_roll_id"])
        self.assertEqual(reroll, duplicate)
        self.assertEqual(0, self.store.cards(self.player)[0]["heroic_inspiration"])

    def test_private_roll_visible_only_to_actor_and_dm(self):
        self.store.roll(self.player, self.first["id"], {"expression": "1d20", "audience": "private", "operation_id": "secret"})
        self.assertEqual(1, len(self.store.rolls(self.player)))
        self.assertEqual(1, len(self.store.rolls(self.dm)))
        self.assertEqual([], self.store.rolls(self.other))

    def test_linked_token_health_is_canonical_and_filtered(self):
        maps = BattlemapStore(self.path, Path(self.temp.name) / "assets")
        scene = maps.create_scene(self.dm, {"name": "Room"})
        token = maps.create_token(self.dm, scene["id"], {"name": "Ada", "character_id": self.first["id"], "owners": [self.first["id"]]})
        own = maps.snapshot(self.player)["tokens"][0]
        other = maps.snapshot(self.other)["tokens"][0]
        self.assertIn("health", own)
        self.assertNotIn("health", other)
        self.store.resource_delta(self.player, self.first["id"], {"field": "hp", "delta": -3, "operation_id": "hurt"})
        self.assertEqual(own["health"]["hp"] - 3, maps.snapshot(self.player)["tokens"][0]["health"]["hp"])
        self.assertEqual(token["character_id"], self.first["id"])


if __name__ == "__main__":
    unittest.main()
