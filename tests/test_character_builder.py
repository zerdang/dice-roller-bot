import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from functions.character_builder import CharacterBuilderStore, ABILITIES, ARRAY
from functions.dnd import DndError


def catalog():
    return [{"class": [
        {"name": "Example Warrior", "source": "XPHB", "startingProficiencies": {"skills": [{"choose": {"from": ["athletics", "perception", "survival"], "count": 2}}]},
         "classFeatures": ["First Feature|Example Warrior|XPHB|1", "Later Feature|Example Warrior|XPHB|2"],
         "startingEquipment": {"defaultData": [{"A": [{"item": "sword|xphb"}, {"value": 500}], "B": [{"value": 1000}]}]}},
        {"name": "Example Warrior", "source": "PHB", "entries": ["Legacy example."]},
    ], "race": [{"name": "Example Folk", "source": "XPHB", "speed": 30}],
        "subrace": [{"name": "Example Lineage", "source": "TEST", "raceName": "Example Folk", "raceSource": "XPHB"}],
        "spell": [{"name": "Sample Spark", "source": "XPHB", "level": 0}, {"name": "Sample Shield", "source": "XPHB", "level": 1},
                  {"name": "Sample Blast", "source": "XPHB", "level": 3}],
        "background": [{"name": "Example Soldier", "source": "XPHB", "skillProficiencies": [{"athletics": True, "intimidation": True}],
                        "ability": [{"choose": {"weighted": {"from": ["str", "dex", "con"], "weights": [2, 1]}}},
                                    {"choose": {"weighted": {"from": ["str", "dex", "con"], "weights": [1, 1, 1]}}}],
                        "startingEquipment": [{"A": [{"item": "pack|xphb"}], "B": [{"value": 5000}]}]}]}]


class CharacterBuilderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = CharacterBuilderStore(Path(self.temp.name) / "builder.db")
        self.version = "a" * 40
        self.store.import_documents(self.version, catalog())
        self.player = {"role": "player", "campaign_id": 1, "character_id": 12, "discord_user_id": "player", "game_system": "dnd"}
        self.other = {**self.player, "character_id": 13, "discord_user_id": "other"}
        self.dm = {**self.player, "role": "warden", "discord_user_id": "dm", "character_id": None}
        self.created = self.store.create(self.player, {"operation_id": "start"})

    def tearDown(self):
        self.temp.cleanup()

    def complete(self):
        draft = copy.deepcopy(self.created["draft"])
        draft.update(name="Test hero", class_skills=["perception", "survival"])
        for field, kind in (("class_id", "class"), ("species_id", "race"), ("background_id", "background")):
            draft[field] = self.store.search(self.player, kind=kind, edition="2024")["items"][0]["id"]
        draft["boosts"].update(strength=2, constitution=1)
        draft["equipment"] = {"class": "A", "background": "B"}
        return draft

    def evaluate(self, draft):
        return self.store.preview(self.player, self.created["id"], {"draft": draft})

    def test_create_is_retry_safe_and_drafts_are_owned(self):
        again = self.store.create(self.player, {"operation_id": "start"})
        self.assertEqual(self.created["id"], again["id"])
        self.assertEqual(1, len(self.store.list_drafts(self.player)))
        self.assertEqual([], self.store.list_drafts(self.other))
        with self.assertRaises(DndError) as caught:
            self.store.get(self.other, self.created["id"])
        self.assertEqual(404, caught.exception.status)
        self.assertEqual(self.created["id"], self.store.get(self.dm, self.created["id"])["id"])
        with self.assertRaises(DndError):
            self.store.get({**self.dm, "campaign_id": 2}, self.created["id"])

    def test_valid_foundation_derives_scores_and_provenance_but_cannot_finalize(self):
        preview = self.evaluate(self.complete())
        self.assertEqual([], preview["errors"])
        self.assertTrue(preview["foundation_complete"])
        self.assertFalse(preview["can_finalize"])
        self.assertEqual(17, preview["scores"]["strength"])
        self.assertEqual(3, preview["modifiers"]["strength"])
        self.assertEqual(["background"], preview["skill_grants"]["athletics"])
        self.assertEqual(["class"], preview["skill_grants"]["perception"])
        self.assertEqual([{"name": "First Feature", "source": "XPHB"}], preview["level_one_features"])
        self.assertIn("5 gp", preview["equipment_options"]["class"][0]["label"])

    def test_equipment_choices_are_checked_against_current_sources(self):
        draft = self.complete()
        draft["equipment"]["class"] = "Z"
        result = self.evaluate(draft)
        self.assertTrue(any(e["step"] == "equipment" for e in result["errors"]))
        draft["equipment"] = {"class": "", "background": ""}
        self.assertEqual(2, len([e for e in self.evaluate(draft)["errors"] if e["step"] == "equipment"]))

    def test_spell_selections_are_pinned_and_reject_higher_levels(self):
        draft = self.complete()
        options = self.store.options(self.player, self.created["id"], "spell")
        self.assertEqual(3, options["total"])
        by_name = {item["name"]: item["id"] for item in options["items"]}
        draft["spell_ids"] = [by_name["Sample Blast"]]
        self.assertTrue(any(e["step"] == "spells" for e in self.evaluate(draft)["errors"]))
        draft["spell_ids"] = [by_name["Sample Spark"]]
        self.assertEqual([], self.evaluate(draft)["errors"])
        self.store.set_policy(self.dm, ["TEST"])
        self.assertTrue(any(e["step"] == "spells" for e in self.evaluate(draft)["errors"]))

    def test_save_conflicts_preserve_last_successful_draft(self):
        draft = self.complete()
        saved = self.store.save(self.player, self.created["id"], {"revision": 1, "draft": draft})
        self.assertEqual(2, saved["revision"])
        with self.assertRaises(DndError) as caught:
            self.store.save(self.player, self.created["id"], {"revision": 1, "draft": {**draft, "name": "Stale edit"}})
        self.assertEqual(409, caught.exception.status)
        self.assertEqual("Test hero", self.store.get(self.player, self.created["id"])["draft"]["name"])

    def test_array_counts_and_background_boosts(self):
        draft = self.complete()
        draft["scores"]["charisma"] = 15
        self.assertTrue(any("standard-array" in e["message"] for e in self.evaluate(draft)["errors"]))
        draft = self.complete()
        draft["boosts"] = dict.fromkeys(ABILITIES, 0)
        draft["boosts"].update(strength=2, wisdom=1)
        self.assertTrue(any("eligible" in e["message"] for e in self.evaluate(draft)["errors"]))
        draft["boosts"] = dict.fromkeys(ABILITIES, 0)
        draft["boosts"].update(strength=1, dexterity=1, constitution=1)
        self.assertEqual([], self.evaluate(draft)["errors"])

    def test_point_buy_cost_curve_and_manual_method_policy(self):
        draft = self.complete()
        draft["method"] = "point_buy"
        draft["scores"] = dict(zip(ABILITIES, [15, 15, 15, 8, 8, 8]))
        self.assertEqual(27, self.evaluate(draft)["points_spent"])
        self.assertEqual([], self.evaluate(draft)["errors"])
        draft["scores"]["intelligence"] = 9
        self.assertTrue(any("exceeds" in e["message"] for e in self.evaluate(draft)["errors"]))
        draft["method"] = "manual"
        self.assertTrue(any("no longer allowed" in e["message"] for e in self.evaluate(draft)["errors"]))
        self.store.save_settings(self.dm, {"revision": 0, "methods": ["manual"]})
        self.assertEqual([], self.evaluate(draft)["errors"])
        draft["scores"]["strength"] = 20
        self.assertTrue(any("above 20" in e["message"] for e in self.evaluate(draft)["errors"]))
        with self.assertRaises(DndError):
            self.store.save_settings(self.player, {"revision": 1, "methods": ["array"]})
        with self.assertRaises(DndError):
            self.store.save_settings(self.dm, {"revision": 0, "methods": ["array"]})

    @patch("functions.character_builder.secrets.randbelow", side_effect=[0, 1, 2, 5] * 6)
    def test_rolls_are_recorded_once_per_campaign_owner_and_cannot_be_forged(self, random):
        rolled = self.store.roll(self.player, self.created["id"])
        self.assertEqual([11] * 6, rolled["preview"]["roll_pool"]["totals"])
        self.store.roll(self.dm, self.created["id"])
        second = self.store.create(self.player, {"operation_id": "second"})
        self.store.roll(self.player, second["id"])
        self.assertEqual(24, random.call_count)
        draft = self.complete()
        draft["method"] = "rolled"
        self.assertTrue(any("recorded total" in e["message"] for e in self.evaluate(draft)["errors"]))
        draft["scores"] = dict.fromkeys(ABILITIES, 11)
        self.assertEqual([], self.evaluate(draft)["errors"])
        self.store.save_settings(self.dm, {"revision": 0, "methods": ["array"]})
        with self.assertRaises(DndError):
            self.store.roll(self.player, self.created["id"])

    def test_catalog_pinning_and_source_restrictions_apply_to_options_and_selected(self):
        draft = self.complete()
        self.store.save(self.player, self.created["id"], {"revision": 1, "draft": draft})
        self.store.import_documents("b" * 40, [{"class": [{"name": "New class", "source": "TEST"}]}])
        choices = self.store.options(self.player, self.created["id"], "class")
        self.assertEqual(2, choices["total"])
        self.assertEqual(self.version, choices["version"])
        self.store.set_policy(self.dm, ["TEST"])
        hidden = self.store.get(self.player, self.created["id"])
        self.assertIsNone(hidden["preview"]["selected"]["class"])
        self.assertEqual(0, self.store.options(self.player, self.created["id"], "class")["total"])

    def test_invalid_payloads_are_rejected_without_clamping(self):
        for bad in ({"scores": []}, {"class_skills": ["invented skill"]}, {"owner": "other"}, {"scores": dict.fromkeys(ABILITIES, 9.5)}):
            with self.assertRaises(DndError):
                self.evaluate({**self.complete(), **bad})
        with self.assertRaises(DndError):
            self.store.create({**self.player, "game_system": "mothership"}, {"operation_id": "bad"})

    def test_parent_changes_recompute_grants_and_keep_invalid_choices_visible(self):
        draft = self.complete()
        draft["class_skills"] = ["athletics", "survival"]
        self.assertTrue(any("overlapping" in warning for warning in self.evaluate(draft)["review"]))
        draft["class_id"] = self.store.search(self.player, kind="class", edition="2014")["items"][0]["id"]
        result = self.evaluate(draft)
        self.assertTrue(any("Choose 0" in e["message"] for e in result["errors"]))
        self.assertTrue(any("compatibility" in warning for warning in result["review"]))


if __name__ == "__main__":
    unittest.main()
