import copy
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from itertools import permutations

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
        {"name": "Zed Mage", "source": "XPHB", "cantripProgression": [1], "preparedSpellsProgression": [1]},
    ], "race": [{"name": "Example Folk", "source": "XPHB", "speed": 30,
                  "additionalSpells": [{"known": {"1": ["Light|XPHB#c"]}}]},
                {"name": "Human", "source": "XPHB", "feats": [{"anyFromCategory": {"category": ["O"], "count": 1}}]}],
        "subrace": [{"name": "Example Lineage", "source": "TEST", "raceName": "Example Folk", "raceSource": "XPHB"}],
        "spell": [{"name": "Sample Spark", "source": "XPHB", "level": 0},
                  {"name": "Sample Shield", "source": "XPHB", "level": 1, "school": "A",
                   "time": [{"number": 1, "unit": "reaction"}], "range": {"type": "self"},
                   "components": {"v": True, "s": True}, "duration": [{"type": "timed", "duration": {"amount": 1, "type": "round"}}]},
                  {"name": "Sample Blast", "source": "XPHB", "level": 3},
                  {"name": "Light", "source": "XPHB", "level": 0}],
        "language": [{"name": "Elvish", "source": "XPHB", "type": "standard"},
                     {"name": "Dwarvish", "source": "XPHB", "type": "standard"},
                     {"name": "Abyssal", "source": "PHB", "type": "exotic"},
                     {"name": "Abyssal", "source": "XPHB", "type": "rare"},
                     {"name": "Common", "source": "XPHB", "type": "standard"}],
        "feat": [{"name": "Sample Origin Feat", "source": "XPHB", "category": "O"},
                 {"name": "Sample General Feat", "source": "XPHB", "category": "G"}],
        "item": [{"name": "Healing Potion", "source": "XPHB", "type": "P"}],
        "background": [{"name": "Example Soldier", "source": "XPHB", "skillProficiencies": [{"athletics": True, "intimidation": True}],
                        "ability": [{"choose": {"weighted": {"from": ["str", "dex", "con"], "weights": [2, 1]}}},
                                    {"choose": {"weighted": {"from": ["str", "dex", "con"], "weights": [1, 1, 1]}}}],
                        "startingEquipment": [{"A": [{"item": "pack|xphb"}], "B": [{"value": 5000}]}]}],
        "_spellSourceLookup": {"xphb": {
            "sample spark": {"class": {"XPHB": {"Zed Mage": True}}},
            "sample shield": {"class": {"XPHB": {"Zed Mage": True}}}
        }}}]


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
        languages = self.store.search(self.player, kind="language")["items"]
        draft["language_ids"] = [item["id"] for item in languages if item["name"] in {"Elvish", "Dwarvish"}]
        return draft

    def evaluate(self, draft):
        return self.store.preview(self.player, self.created["id"], {"draft": draft})

    def caster_draft(self):
        draft = self.complete()
        draft["class_id"] = next(item["id"] for item in self.store.search(self.player, kind="class", edition="2024")["items"] if item["name"] == "Zed Mage")
        draft["class_skills"] = []
        self.store.save(self.player, self.created["id"], {"revision": 1, "draft": draft})
        return draft

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

    def test_owner_deletes_unapproved_draft(self):
        with self.assertRaises(DndError) as denied:
            self.store.delete(self.other, self.created["id"])
        self.assertEqual(404, denied.exception.status)
        self.assertTrue(self.store.delete(self.player, self.created["id"])["deleted"])
        self.assertEqual([], self.store.list_drafts(self.player))

    def test_draft_summaries_show_pinned_identity_and_scores_with_increases(self):
        empty = self.store.list_drafts(self.player)[0]
        self.assertIsNone(empty["class_name"])
        self.assertIsNone(empty["species_name"])
        draft = self.complete()
        self.store.save(self.player, self.created["id"], {"revision": 1, "draft": draft})
        self.store.import_documents("b" * 40, [{"class": [{"name": "Different class", "source": "XPHB"}]}])
        summary = self.store.list_drafts(self.player)[0]
        self.assertEqual("Example Warrior", summary["class_name"])
        self.assertEqual("Example Folk", summary["species_name"])
        self.assertEqual({ability: draft["scores"][ability] + draft["boosts"][ability] for ability in ABILITIES}, summary["scores"])
        self.assertEqual([], self.store.list_drafts(self.other))
        self.store.set_policy(self.dm, ["TEST"])
        restricted = self.store.list_drafts(self.player)[0]
        self.assertIsNone(restricted["class_name"])
        self.assertIsNone(restricted["species_name"])

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
        draft = self.caster_draft()
        options = self.store.options(self.player, self.created["id"], "spell")
        self.assertEqual(2, options["total"])
        by_name = {item["name"]: item["id"] for item in options["items"]}
        blast_id = next(item["id"] for item in self.store.search(self.player, kind="spell")["items"] if item["name"] == "Sample Blast")
        draft["spell_ids"] = [blast_id]
        self.assertTrue(any(e["step"] == "spells" for e in self.evaluate(draft)["errors"]))
        draft["spell_ids"] = [by_name["Sample Spark"], by_name["Sample Shield"]]
        self.assertEqual([], self.evaluate(draft)["errors"])
        self.store.set_policy(self.dm, ["TEST"])
        self.assertTrue(any(e["step"] == "spells" for e in self.evaluate(draft)["errors"]))

    def test_spell_options_filter_by_level_and_school_with_visible_metadata(self):
        self.caster_draft()
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

    def test_noncasters_cannot_select_spells_and_innate_spells_are_separate(self):
        draft = self.complete()
        self.store.save(self.player, self.created["id"], {"revision": 1, "draft": draft})
        self.assertEqual(0, self.store.options(self.player, self.created["id"], "spell")["total"])
        spark = next(item for item in self.store.search(self.player, kind="spell")["items"] if item["name"] == "Sample Spark")
        draft["spell_ids"] = [spark["id"]]
        preview = self.evaluate(draft)
        self.assertTrue(any("class grants 0" in error["message"] for error in preview["errors"]))
        self.assertEqual(["Light"], [spell["name"] for spell in preview["innate_spells"]])

    def test_explicit_spell_lists_browse_other_classes_without_granting_eligibility(self):
        documents = catalog()
        documents[0]["class"].append({"name": "Other Mage", "source": "PHB", "cantripProgression": [1]})
        documents[0]["_spellSourceLookup"]["xphb"]["light"] = {"class": {"PHB": {"Other Mage": True}}}
        # Import before starting a new draft: lists must stay pinned to its catalog.
        self.store.import_documents("b" * 40, documents)
        self.created = self.store.create(self.player, {"operation_id": "spell-lists"})
        draft = self.caster_draft()
        own = self.store.options(self.player, self.created["id"], "spell")
        self.assertEqual({"Sample Spark", "Sample Shield"}, {s["name"] for s in own["items"]})
        other = next(c for c in own["spell_lists"] if c["name"] == "Other Mage")
        result = self.store.options(self.player, self.created["id"], "spell", spell_list=other["id"], level="0")
        self.assertEqual(["Light"], [s["name"] for s in result["items"]])
        self.assertFalse(result["items"][0]["eligible_for_character"])
        draft["spell_ids"] = [result["items"][0]["id"]]
        self.assertTrue(any("Light is not available to Zed Mage" == e["message"].rstrip(".") for e in self.evaluate(draft)["errors"]))
        self.assertEqual(4, self.store.options(self.player, self.created["id"], "spell", spell_list="all")["total"])
        with self.assertRaises(DndError):
            self.store.options(self.player, self.created["id"], "spell", spell_list="unknown")
        self.store.import_documents("c" * 40, [{"class": [{"name": "New class", "source": "XPHB"}]}])
        self.assertEqual(1, self.store.options(self.player, self.created["id"], "spell", spell_list=other["id"])["total"])
        self.store.set_policy(self.dm, ["XPHB"])
        with self.assertRaises(DndError):
            self.store.options(self.player, self.created["id"], "spell", spell_list=other["id"])

    def test_missing_spell_lookup_falls_back_to_review_without_blocking(self):
        draft = self.caster_draft()
        with self.store.connect() as db:
            db.execute("DELETE FROM reference_spell_class WHERE version=?", (self.version,))
        options = self.store.options(self.player, self.created["id"], "spell", level="1")
        self.assertEqual(["Sample Shield"], [item["name"] for item in options["items"]])
        spark = next(item for item in self.store.search(self.player, kind="spell", level="0")["items"] if item["name"] == "Sample Spark")
        draft["spell_ids"] = [spark["id"], options["items"][0]["id"]]
        preview = self.evaluate(draft)
        self.assertEqual([], preview["errors"])
        self.assertFalse(preview["spell_eligibility_ready"])
        self.assertTrue(any("spell-list filtering is unavailable" in message for message in preview["review"]))

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
        self.assertEqual({"base": 15, "increases": [{"label": "Background Points (Example Soldier)", "points": 2}]}, card["ability_sources"]["strength"])
        self.assertEqual("Example Warrior", card["identity"]["class_name"])
        self.assertEqual(3, len(card["inventory"]))
        with self.store.connect() as db:
            snapshot = db.execute("SELECT snapshot FROM creation_finalization WHERE draft_id=?", (self.created["id"],)).fetchone()[0]
        self.assertEqual("Old hero", __import__("json").loads(snapshot)["character"]["name"])
        # Older approved sheets gain source details when the source column migrates.
        with self.store.connect() as db:
            db.execute("ALTER TABLE dnd_character DROP COLUMN ability_sources_json")
        migrated = DndStore(self.store.path).cards(self.player)[0]
        self.assertEqual(15, migrated["ability_sources"]["strength"]["base"])
        self.assertEqual(2, migrated["ability_sources"]["strength"]["increases"][0]["points"])

    def test_player_submits_own_character_when_dm_review_is_disabled(self):
        with self.store.connect() as db:
            db.execute("INSERT INTO campaign(id,guild_id,name,game_system,owner_discord_user_id,warden_token_hash,created_at) VALUES(1,'g','Table','dnd','dm','token','now')")
            db.execute("INSERT INTO character(id,campaign_id,discord_user_id,name,player_token_hash,created_at) VALUES(12,1,'player','Player','player-token','now')")
        policy = self.store.settings(self.dm)
        self.store.save_settings(self.dm, {**policy, "manual_review_required": False})
        saved = self.store.save(self.player, self.created["id"], {"revision": 1, "draft": self.complete()})
        result = self.store.finalize(self.player, self.created["id"], {"revision": saved["revision"], "reviewed": True})
        self.assertEqual(12, result["character_id"])

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

    def test_languages_are_source_independent_and_deduplicated_by_name(self):
        draft = self.complete()
        languages = self.store.search(self.player, kind="language")["items"]
        abyssal = [item["id"] for item in languages if item["name"] == "Abyssal"]
        elvish = next(item["id"] for item in languages if item["name"] == "Elvish")
        common = next(item["id"] for item in languages if item["name"] == "Common")
        draft["language_ids"] = [*abyssal, elvish]
        preview = self.evaluate(draft)
        self.assertEqual([], preview["errors"])
        self.assertEqual(["Abyssal", "Elvish"], [item["name"] for item in preview["languages"]])
        draft["language_ids"] = [abyssal[0], abyssal[1]]
        self.assertEqual(1, len([error for error in self.evaluate(draft)["errors"] if error["step"] == "features"]))
        draft["language_ids"] = [common, elvish]
        self.assertTrue(any("other than Common" in error["message"] for error in self.evaluate(draft)["errors"]))

    def test_language_picker_has_unique_names_aliases_and_no_book_requirement(self):
        choices = self.store.options(self.player, self.created["id"], "language")
        self.assertEqual(3, choices["total"])
        self.assertEqual(["Abyssal", "Dwarvish", "Elvish"], [item["name"] for item in choices["items"]])
        abyssal = next(item for item in choices["items"] if item["name"] == "Abyssal")
        self.assertEqual(2, len(abyssal["ids"]))
        self.assertNotIn("source", abyssal)
        self.store.set_policy(self.dm, [])
        self.assertEqual(choices, self.store.options(self.player, self.created["id"], "language"))
        result = self.store.options(self.player, self.created["id"], "language", query=" ABYSS ", source="unowned", edition="2014")
        self.assertEqual([abyssal], result["items"])
        # Restore the non-language sources used by the rest of this draft.
        self.store.set_policy(self.dm, ["XPHB"])
        draft = self.complete()
        elvish_id = next(item["id"] for item in self.store.search(self.dm, kind="language")["items"] if item["name"] == "Elvish")
        draft["language_ids"] = [*abyssal["ids"], elvish_id]
        preview = self.evaluate(draft)
        self.assertEqual([], preview["errors"])
        self.assertEqual(2, len(preview["languages"]))

    def test_language_deduplication_precedes_pagination_and_stays_pinned(self):
        documents = catalog()
        documents[0]["language"] = [{"name": f"Language {i:03}", "source": source} for i in range(65) for source in ("PHB", "XPHB")]
        documents[0]["language"].append({"name": "language   000", "source": "OTHER"})
        self.store.import_documents("b" * 40, documents)
        self.created = self.store.create(self.player, {"operation_id": "languages"})
        first = self.store.options(self.player, self.created["id"], "language")
        second = self.store.options(self.player, self.created["id"], "language", offset=60)
        self.assertEqual(65, first["total"])
        self.assertEqual(60, len(first["items"]))
        self.assertEqual(5, len(second["items"]))
        self.assertEqual(3, len(first["items"][0]["ids"]))
        self.assertFalse({item["name"] for item in first["items"]} & {item["name"] for item in second["items"]})
        self.store.import_documents("c" * 40, [{"language": [{"name": "New language", "source": "XPHB"}]}])
        self.assertEqual(first, self.store.options(self.player, self.created["id"], "language"))
        with self.assertRaises(DndError):
            self.store.options(self.player, self.created["id"], "language", offset=-1)

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
        self.store.save_settings(self.dm, {"revision": 0, "methods": ["array"], "flexible_background_abilities": False})
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

    def test_campaign_can_allow_flexible_background_abilities(self):
        draft = self.complete()
        draft["boosts"] = dict.fromkeys(ABILITIES, 0)
        draft["boosts"].update(wisdom=2, charisma=1)
        self.assertTrue(self.store.settings(self.dm)["flexible_background_abilities"])
        self.assertEqual([], self.evaluate(draft)["errors"])
        settings = self.store.save_settings(self.dm, {
            "revision": 0, "methods": ["array", "point_buy", "rolled"],
            "flexible_background_abilities": False,
        })
        self.assertFalse(settings["flexible_background_abilities"])
        self.assertTrue(any("eligible" in error["message"] for error in self.evaluate(draft)["errors"]))
        settings = self.store.save_settings(self.dm, {"revision": 1, "methods": ["array"]})
        self.assertFalse(settings["flexible_background_abilities"])
        settings = self.store.save_settings(self.dm, {"revision": 2, "methods": ["array"], "flexible_background_abilities": True})
        self.assertTrue(settings["flexible_background_abilities"])
        self.assertEqual([], self.evaluate(draft)["errors"])

    def test_all_revised_background_allocations_and_actionable_field_errors(self):
        self.store.save_settings(self.dm, {"revision": 0, "methods": ["array"], "flexible_background_abilities": False})
        draft = self.complete()
        for first, second in permutations(["strength", "dexterity", "constitution"], 2):
            with self.subTest(first=first, second=second):
                draft["boosts"] = {**dict.fromkeys(ABILITIES, 0), first: 2, second: 1}
                self.assertEqual([], self.evaluate(draft)["errors"])
        draft["boosts"] = {**dict.fromkeys(ABILITIES, 0), "strength": 1, "dexterity": 1, "constitution": 1}
        self.assertEqual([], self.evaluate(draft)["errors"])
        draft["boosts"] = {**dict.fromkeys(ABILITIES, 0), "strength": 2, "wisdom": 1}
        errors = self.evaluate(draft)["errors"]
        self.assertEqual(["boosts.wisdom"], errors[0]["fields"])
        self.assertIn("+0", errors[0]["message"])
        draft["boosts"]["wisdom"] = 0
        errors = self.evaluate(draft)["errors"]
        self.assertIn("assigned +2", errors[0]["message"])
        self.assertEqual({"boosts.strength", "boosts.dexterity", "boosts.constitution"}, set(errors[0]["fields"]))

    def test_background_simple_choices_fixed_allocations_and_separate_alternatives(self):
        self.store.save_settings(self.dm, {"revision": 0, "methods": ["array"], "flexible_background_abilities": False})
        draft = self.complete()
        def background_ability(patterns):
            with self.store.connect() as db:
                raw = json.loads(db.execute("SELECT raw FROM reference_entry WHERE id=? AND version=?", (draft["background_id"], self.version)).fetchone()[0])
                raw["ability"] = patterns
                db.execute("UPDATE reference_entry SET raw=? WHERE id=? AND version=?", (json.dumps(raw), draft["background_id"], self.version))
        # A fixed +2 combined with a simple choice was previously rejected.
        background_ability([{"str": 2, "choose": {"from": ["dex", "con"], "amount": 1}}])
        self.assertEqual([], self.evaluate(draft)["errors"])
        background_ability([{"str": 2, "con": 1}])
        self.assertEqual([], self.evaluate(draft)["errors"])
        # Do not accept a mixture of two individually valid alternatives.
        background_ability([{"str": 2, "dex": 1}, {"con": 2, "wis": 1}])
        self.assertTrue(any(e["step"] == "abilities" for e in self.evaluate(draft)["errors"]))
        draft["boosts"] = {**dict.fromkeys(ABILITIES, 0), "constitution": 2, "wisdom": 1}
        self.assertEqual([], self.evaluate(draft)["errors"])

    def test_background_score_cap_identifies_both_fields(self):
        draft = self.complete()
        self.store.save_settings(self.dm, {"revision": 0, "methods": ["manual"]})
        draft["method"] = "manual"
        draft["scores"]["strength"] = 20
        error = next(e for e in self.evaluate(draft)["errors"] if "above 20" in e["message"])
        self.assertEqual(["scores.strength", "boosts.strength"], error["fields"])

    def test_unrestricted_allocations_still_require_three_points_and_maximum_two_per_ability(self):
        draft = self.complete()
        for boosts in ({"wisdom": 2}, {"wisdom": 2, "charisma": 2}, {}):
            with self.subTest(boosts=boosts):
                draft["boosts"] = {**dict.fromkeys(ABILITIES, 0), **boosts}
                preview = self.evaluate(draft)
                self.assertFalse(preview["can_finalize"])
                self.assertTrue(any(e["step"] == "abilities" for e in preview["errors"]))
        draft["boosts"] = {**dict.fromkeys(ABILITIES, 0), "wisdom": 3}
        with self.assertRaises(DndError):
            self.evaluate(draft)
        draft["boosts"] = {**dict.fromkeys(ABILITIES, 0), "wisdom": 1, "charisma": 1, "intelligence": 1}
        self.assertEqual([], self.evaluate(draft)["errors"])

    def test_older_policy_without_ability_rule_uses_unrestricted_default(self):
        with self.store.connect() as db:
            db.execute("INSERT INTO creation_policy VALUES(?,?,?)", (1, 1, json.dumps({"methods": ["array"]})))
        self.assertTrue(self.store.settings(self.player)["flexible_background_abilities"])
        self.assertTrue(self.store.save_settings(self.dm, {"revision": 1, "methods": ["array"]})["flexible_background_abilities"])

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
        self.assertEqual(3, choices["total"])
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
