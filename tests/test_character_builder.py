import copy
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from functions.character_builder import CharacterBuilderStore, ABILITIES, ARRAY
from functions.dnd import DndError
from functions.dnd import DndStore
from functions.companion import CompanionStore
from PIL import Image


def catalog():
    return [{"class": [
        {"name": "Example Warrior", "source": "XPHB", "startingProficiencies": {"skills": [{"choose": {"from": ["athletics", "perception", "survival"], "count": 2}}]},
         "classFeatures": ["First Feature|Example Warrior|XPHB|1", "Later Feature|Example Warrior|XPHB|2"],
         "startingEquipment": {"defaultData": [{"A": [{"item": "sword|xphb"}, {"value": 500}], "B": [{"value": 1000}]}]}},
        {"name": "Example Warrior", "source": "PHB", "entries": ["Legacy example."]},
    ], "race": [{"name": "Example Folk", "source": "XPHB", "speed": 30},
                {"name": "Human", "source": "XPHB", "feats": [{"anyFromCategory": {"category": ["O"], "count": 1}}]}],
        "subrace": [{"name": "Example Lineage", "source": "TEST", "raceName": "Example Folk", "raceSource": "XPHB"}],
        "spell": [{"name": "Sample Spark", "source": "XPHB", "level": 0},
                  {"name": "Sample Shield", "source": "XPHB", "level": 1, "school": "A",
                   "time": [{"number": 1, "unit": "reaction"}], "range": {"type": "self"},
                   "components": {"v": True, "s": True}, "duration": [{"type": "timed", "duration": {"amount": 1, "type": "round"}}]},
                  {"name": "Sample Blast", "source": "XPHB", "level": 3}],
        "language": [{"name": "Elvish", "source": "XPHB", "type": "standard"}, {"name": "Dwarvish", "source": "XPHB", "type": "standard"}],
        "feat": [{"name": "Sample Origin Feat", "source": "XPHB", "category": "O"},
                 {"name": "Sample General Feat", "source": "XPHB", "category": "G"}],
        "item": [{"name": "Healing Potion", "source": "XPHB", "type": "P"}],
        "background": [{"name": "Example Soldier", "source": "XPHB", "skillProficiencies": [{"athletics": True, "intimidation": True}],
                        "ability": [{"choose": {"weighted": {"from": ["str", "dex", "con"], "weights": [2, 1]}}},
                                    {"choose": {"weighted": {"from": ["str", "dex", "con"], "weights": [1, 1, 1]}}}],
                        "startingEquipment": [{"A": [{"item": "pack|xphb"}], "B": [{"value": 5000}]}]}]}]


class CharacterBuilderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        CompanionStore(Path(self.temp.name) / "builder.db")
        DndStore(Path(self.temp.name) / "builder.db")
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
        draft["language_ids"] = [item["id"] for item in self.store.search(self.player, kind="language")["items"]]
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

    def test_valid_foundation_derives_scores_and_provenance_for_dm_review(self):
        preview = self.evaluate(self.complete())
        self.assertEqual([], preview["errors"])
        self.assertTrue(preview["foundation_complete"])
        self.assertTrue(preview["can_finalize"])
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

    def test_spell_options_filter_by_level_and_school_with_visible_metadata(self):
        result = self.store.options(self.player, self.created["id"], "spell", level="1", school="A")
        self.assertEqual(1, result["total"])
        spell = result["items"][0]
        self.assertEqual("Sample Shield", spell["name"])
        self.assertEqual(1, spell["metadata"]["level"])
        self.assertEqual("Abjuration", spell["metadata"]["school"])
        self.assertEqual("1 reaction", spell["metadata"]["casting_time"])
        self.assertEqual("V, S", spell["metadata"]["components"])
        detail = self.store.detail(self.player, spell["id"], self.version)
        self.assertEqual(spell["metadata"], detail["metadata"])
        self.assertEqual(0, self.store.options(self.player, self.created["id"], "spell", level="0", school="A")["total"])

    def test_dm_finalization_is_atomic_retry_safe_and_preserves_prior_sheet(self):
        CompanionStore(self.store.path)
        DndStore(self.store.path)
        with self.store.connect() as db:
            db.execute("INSERT INTO campaign(id,guild_id,name,game_system,warden_token_hash,created_at) VALUES(1,'g','Table','dnd','token','now')")
            db.execute("INSERT INTO character(id,campaign_id,discord_user_id,name,player_token_hash,created_at) VALUES(12,1,'player','Old hero','player-token','now')")
        draft = self.complete()
        saved = self.store.save(self.player, self.created["id"], {"revision": 1, "draft": draft})
        target = self.store.get(self.dm, self.created["id"])["target"]
        body = {"revision": saved["revision"], "target_revision": target["revision"], "reviewed": True, "replace_existing": True}
        with self.assertRaises(DndError):
            self.store.finalize(self.player, self.created["id"], body)
        with self.assertRaises(DndError):
            self.store.finalize(self.dm, self.created["id"], {**body, "target_revision": 999})
        self.assertEqual("Old hero", DndStore(self.store.path).cards(self.player)[0]["name"])
        result = self.store.finalize(self.dm, self.created["id"], body)
        self.assertEqual(12, result["character_id"])
        self.assertTrue(self.store.finalize(self.dm, self.created["id"], body)["already_finalized"])
        card = DndStore(self.store.path).cards(self.player)[0]
        self.assertEqual("Test hero", card["name"])
        self.assertEqual(17, card["ability_scores"]["strength"])
        self.assertEqual("Example Warrior", card["identity"]["class_name"])
        self.assertEqual(3, len(card["inventory"]))
        with self.store.connect() as db:
            snapshot = db.execute("SELECT snapshot FROM creation_finalization WHERE draft_id=?", (self.created["id"],)).fetchone()[0]
        self.assertEqual("Old hero", __import__("json").loads(snapshot)["character"]["name"])

    def test_portrait_upload_is_owned_and_normalized(self):
        image = Image.new("RGB", (900, 600), "#aaccdd")
        data = io.BytesIO()
        image.save(data, format="PNG")
        self.store.upload_portrait(self.player, self.created["id"], data.getvalue())
        with Image.open(io.BytesIO(self.store.portrait(self.player, self.created["id"]))) as saved:
            self.assertEqual((512, 512), saved.size)
            self.assertEqual("JPEG", saved.format)
        with self.assertRaises(DndError):
            self.store.portrait(self.other, self.created["id"])
        with self.assertRaises(DndError):
            self.store.upload_portrait(self.player, self.created["id"], b"not an image")

    def test_human_origin_feat_and_two_languages_are_required(self):
        draft = self.complete()
        draft["species_id"] = next(item["id"] for item in self.store.options(self.player, self.created["id"], "race")["items"] if item["name"] == "Human")
        self.assertTrue(any("Origin feats" in e["message"] for e in self.evaluate(draft)["errors"]))
        feats = {item["name"]: item["id"] for item in self.store.options(self.player, self.created["id"], "feat")["items"]}
        draft["feat_ids"] = [feats["Sample General Feat"]]
        self.assertTrue(any("not an Origin feat" in e["message"] for e in self.evaluate(draft)["errors"]))
        draft["feat_ids"] = [feats["Sample Origin Feat"]]
        self.assertEqual([], self.evaluate(draft)["errors"])
        draft["language_ids"] = draft["language_ids"][:1]
        self.assertTrue(any(e["step"] == "features" for e in self.evaluate(draft)["errors"]))

    def test_dm_grants_reference_item_once_to_a_campaign_character(self):
        with self.store.connect() as db:
            db.execute("INSERT INTO campaign(id,guild_id,name,game_system,warden_token_hash,created_at) VALUES(1,'g','Table','dnd','token','now')")
            db.execute("INSERT INTO character(id,campaign_id,discord_user_id,name,player_token_hash,created_at) VALUES(12,1,'player','Hero','player-token','now')")
        item_id = self.store.search(self.dm, kind="item")["items"][0]["id"]
        body = {"character_id": 12, "revision": 1, "quantity": 2, "operation_id": "give-once"}
        with self.assertRaises(DndError):
            self.store.grant_item(self.player, item_id, body)
        result = self.store.grant_item(self.dm, item_id, body)
        self.assertEqual(result, self.store.grant_item(self.dm, item_id, body))
        self.assertEqual(2, DndStore(self.store.path).cards(self.player)[0]["inventory"][0]["quantity"])
        with self.assertRaises(DndError) as stale:
            self.store.grant_item(self.dm, item_id, {**body, "operation_id": "stale"})
        self.assertEqual(409, stale.exception.status)
        with self.assertRaises(DndError):
            self.store.grant_item({**self.dm, "campaign_id": 2}, item_id, {**body, "operation_id": "other-campaign"})

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
