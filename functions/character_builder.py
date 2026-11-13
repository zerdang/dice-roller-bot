"""Owned character drafts and server-validated level-one ability allocation.

Drafts deliberately do not modify live character sheets. Finalization will consume
the completed, reviewed draft after the remaining feature/equipment steps exist.
"""
import json
import secrets
import io
from collections import Counter
from PIL import Image, ImageOps, UnidentifiedImageError

from functions.dnd import ABILITIES, SKILL_ABILITIES, DndError, DndStore, _now
from functions.reference import ReferenceStore

SHORT = dict(zip(("str", "dex", "con", "int", "wis", "cha"), ABILITIES))
SKILLS = {name.lower(): name for name in SKILL_ABILITIES}
ARRAY = [15, 14, 13, 12, 10, 8]
COST = {8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9}
DEFAULT_POLICY = {"methods": ["array", "point_buy", "rolled"], "manual_review_required": True}
SCHEMA = """
CREATE TABLE IF NOT EXISTS creation_draft (
 id TEXT PRIMARY KEY, campaign_id INTEGER NOT NULL, owner TEXT NOT NULL,
 create_key TEXT NOT NULL, version TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(campaign_id,owner,create_key)
);
CREATE INDEX IF NOT EXISTS creation_draft_owner ON creation_draft(campaign_id,owner);
CREATE TABLE IF NOT EXISTS creation_policy (campaign_id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS creation_roll_pool (
 campaign_id INTEGER NOT NULL, owner TEXT NOT NULL, dice TEXT NOT NULL,
 created_at TEXT NOT NULL, PRIMARY KEY(campaign_id,owner)
);
CREATE TABLE IF NOT EXISTS creation_finalization (
 draft_id TEXT PRIMARY KEY, character_id INTEGER NOT NULL, snapshot TEXT NOT NULL,
 finalized_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS creation_portrait (
 draft_id TEXT PRIMARY KEY, image BLOB NOT NULL, updated_at TEXT NOT NULL
);
"""


def integer(value, low, high, label):
    if type(value) is not int or not low <= value <= high:
        raise DndError(f"{label} must be a whole number from {low} to {high}")
    return value


class CharacterBuilderStore(ReferenceStore):
    def __init__(self, path):
        super().__init__(path)
        with self.connect() as db:
            db.executescript(SCHEMA)

    @staticmethod
    def owner(auth):
        ReferenceStore.require_auth(auth)
        if auth.get("discord_user_id"):
            return "user:" + str(auth["discord_user_id"])
        if auth["role"] == "warden":
            return "legacy:dm"
        if not auth.get("character_id"):
            raise DndError("Character ownership is required", 403)
        return "character:" + str(auth["character_id"])

    @staticmethod
    def campaign_policy(db, campaign):
        row = db.execute("SELECT revision,payload FROM creation_policy WHERE campaign_id=?", (campaign,)).fetchone()
        return {"revision": row["revision"], **json.loads(row["payload"])} if row else {"revision": 0, **DEFAULT_POLICY}

    def settings(self, auth):
        self.require_auth(auth)
        with self.connect() as db:
            return self.campaign_policy(db, auth["campaign_id"])

    def save_settings(self, auth, body):
        self.require_auth(auth)
        if auth["role"] != "warden":
            raise DndError("Only the DM can change creation settings", 403)
        if not isinstance(body, dict):
            raise DndError("JSON object required")
        methods = body.get("methods")
        if not isinstance(methods, list) or not methods or any(not isinstance(m, str) or m not in {"array", "point_buy", "rolled", "manual"} for m in methods):
            raise DndError("Choose at least one supported ability method")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            current = self.campaign_policy(db, auth["campaign_id"])
            if body.get("revision") != current["revision"]:
                raise DndError("Creation settings changed; reload before saving", 409)
            value = {"methods": sorted(set(methods)), "manual_review_required": True}
            db.execute("INSERT OR REPLACE INTO creation_policy VALUES(?,?,?)", (auth["campaign_id"], current["revision"] + 1, json.dumps(value)))
        return self.settings(auth)

    def owned(self, db, auth, draft_id):
        owner = self.owner(auth)
        row = db.execute("SELECT * FROM creation_draft WHERE id=? AND campaign_id=?", (draft_id, auth["campaign_id"])).fetchone()
        if not row or (row["owner"] != owner and auth["role"] != "warden"):
            raise DndError("Draft not found", 404)
        return row

    def create(self, auth, body):
        owner = self.owner(auth)
        if not isinstance(body, dict) or not isinstance(body.get("operation_id"), str) or not 1 <= len(body["operation_id"]) <= 100:
            raise DndError("A creation operation ID is required")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute("SELECT id FROM creation_draft WHERE campaign_id=? AND owner=? AND create_key=?", (auth["campaign_id"], owner, body["operation_id"])).fetchone()
            if existing:
                draft_id = existing["id"]
            else:
                active = db.execute("SELECT version FROM reference_active WHERE singleton=1").fetchone()
                if not active:
                    raise DndError("Load the reference catalog before creating a draft", 409)
                count = db.execute("SELECT count(*) FROM creation_draft WHERE campaign_id=? AND owner=?", (auth["campaign_id"], owner)).fetchone()[0]
                if count >= 30:
                    raise DndError("Draft limit reached (30); resume an existing draft")
                settings = self.campaign_policy(db, auth["campaign_id"])
                payload = {"name": "", "class_id": "", "species_id": "", "background_id": "", "lineage_id": "",
                           "method": settings["methods"][0], "scores": dict(zip(ABILITIES, ARRAY)),
                           "boosts": dict.fromkeys(ABILITIES, 0), "class_skills": [],
                           "equipment": {"class": "", "background": ""}, "feature_choices": "", "spell_choices": "", "spell_ids": [], "language_ids": [], "feat_ids": [], "notes": ""}
                draft_id, now = secrets.token_hex(16), _now()
                db.execute("INSERT INTO creation_draft VALUES(?,?,?,?,?,1,?,?,?)", (draft_id, auth["campaign_id"], owner, body["operation_id"], active["version"], json.dumps(payload), now, now))
        return self.get(auth, draft_id)

    def list_drafts(self, auth):
        owner = self.owner(auth)
        with self.connect() as db:
            rows = db.execute("SELECT id,payload,revision,updated_at,owner FROM creation_draft WHERE campaign_id=?" + ("" if auth["role"] == "warden" else " AND owner=?") + " ORDER BY updated_at DESC,id", [auth["campaign_id"]] + ([] if auth["role"] == "warden" else [owner])).fetchall()
            return [{"id": r["id"], "name": json.loads(r["payload"])["name"] or "Unnamed draft", "revision": r["revision"], "updated_at": r["updated_at"], "is_own": r["owner"] == owner} for r in rows]

    @staticmethod
    def clean(body):
        if not isinstance(body, dict):
            raise DndError("Draft must be an object")
        allowed = {"name", "class_id", "species_id", "background_id", "lineage_id", "method", "scores", "boosts", "class_skills", "equipment", "feature_choices", "spell_choices", "spell_ids", "language_ids", "feat_ids", "notes"}
        if set(body) - allowed:
            raise DndError("Unknown draft fields")
        out = {}
        for key in ("name", "class_id", "species_id", "background_id", "lineage_id", "method", "notes"):
            value = body.get(key, "")
            if not isinstance(value, str) or len(value) > (6000 if key == "notes" else 100):
                raise DndError(f"Invalid {key}")
            out[key] = value.strip()
        if out["method"] not in {"array", "point_buy", "rolled", "manual"}:
            raise DndError("Unknown ability method")
        for key, low, high in (("scores", 1, 20), ("boosts", 0, 2)):
            values = body.get(key)
            if not isinstance(values, dict) or set(values) != set(ABILITIES):
                raise DndError(f"{key} must include all six abilities")
            out[key] = {a: integer(values[a], low, high, a) for a in ABILITIES}
        skills = body.get("class_skills", [])
        if not isinstance(skills, list) or len(skills) > 18 or any(not isinstance(s, str) or s not in SKILLS for s in skills) or len(set(skills)) != len(skills):
            raise DndError("Invalid class skill selections")
        out["class_skills"] = skills
        equipment = body.get("equipment", {"class": "", "background": ""})
        if not isinstance(equipment, dict) or set(equipment) != {"class", "background"} or any(not isinstance(value, str) or len(value) > 20 for value in equipment.values()):
            raise DndError("Invalid starting equipment choices")
        out["equipment"] = equipment
        for key in ("feature_choices", "spell_choices"):
            value = body.get(key, "")
            if not isinstance(value, str) or len(value) > 6000:
                raise DndError(f"Invalid {key}")
            out[key] = value.strip()
        for key, maximum in (("spell_ids", 50), ("language_ids", 10), ("feat_ids", 10)):
            values = body.get(key, [])
            if not isinstance(values, list) or len(values) > maximum or any(not isinstance(value, str) or len(value) != 32 for value in values) or len(set(values)) != len(values):
                raise DndError(f"Invalid {key} selections")
            out[key] = values
        return out

    def save(self, auth, draft_id, body):
        if not isinstance(body, dict):
            raise DndError("JSON object required")
        payload = self.clean(body.get("draft"))
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = self.owned(db, auth, draft_id)
            if db.execute("SELECT 1 FROM creation_finalization WHERE draft_id=?", (draft_id,)).fetchone():
                raise DndError("This draft is already finalized", 409)
            if body.get("revision") != row["revision"]:
                raise DndError("This draft changed in another window. Reload it before saving.", 409)
            # Do not reject incomplete but structurally valid drafts; preview gives actionable errors.
            db.execute("UPDATE creation_draft SET payload=?,revision=revision+1,updated_at=? WHERE id=?", (json.dumps(payload), _now(), draft_id))
        return self.get(auth, draft_id)

    def roll(self, auth, draft_id):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = self.owned(db, auth, draft_id)
            if "rolled" not in self.campaign_policy(db, auth["campaign_id"])["methods"]:
                raise DndError("Rolled abilities are disabled by the DM", 403)
            # Players share one recorded pool across their campaign drafts to avoid rerolling via new drafts.
            roll_owner = self.roll_owner(row)
            old = db.execute("SELECT dice FROM creation_roll_pool WHERE campaign_id=? AND owner=?", (auth["campaign_id"], roll_owner)).fetchone()
            if not old:
                dice = [[secrets.randbelow(6) + 1 for _ in range(4)] for _ in range(6)]
                db.execute("INSERT INTO creation_roll_pool VALUES(?,?,?,?)", (auth["campaign_id"], roll_owner, json.dumps(dice), _now()))
        return self.get(auth, draft_id)

    @staticmethod
    def roll_owner(row):
        # Ownership, rather than caller role, determines the pool even when a DM opens a player draft.
        return row["owner"]

    def selected(self, db, auth, version, entry_id, kinds):
        if not entry_id:
            return None
        clauses, args, _ = self.filters(db, auth, version)
        row = db.execute("SELECT * FROM reference_entry e WHERE " + " AND ".join(clauses) + " AND e.id=?", [*args, entry_id]).fetchone()
        if not row or row["kind"] not in kinds:
            return None
        raw = json.loads(row["raw"])
        # Resolve straightforward inheritance through the same importer; unsupported copies stay flagged.
        parents = []
        cursor, seen = raw, set()
        while cursor.get("_copy"):
            parent = cursor["_copy"]
            key = (parent.get("name"), parent.get("source"))
            if key in seen:
                break
            seen.add(key)
            p = db.execute("SELECT raw FROM reference_entry WHERE version=? AND kind=? AND name=? COLLATE NOCASE AND source=? COLLATE NOCASE", (version, row["kind"], key[0], key[1])).fetchone()
            if not p:
                break
            cursor = json.loads(p["raw"])
            parents.append(cursor)
        # Rules engine never consumes modified inherited values as resolved mechanics.
        resolved = raw
        if not json.loads(row["warnings"]) and parents:
            resolved = {}
            for parent in reversed(parents):
                resolved.update(parent)
            resolved.update(raw)
        return {"id": row["id"], "name": row["name"], "source": row["source"], "edition": row["edition"],
                "text": row["text"], "warnings": json.loads(row["warnings"]), "raw": resolved}

    def evaluate(self, db, auth, row, payload):
        settings = self.campaign_policy(db, auth["campaign_id"])
        errors, review = [], []
        def error(step, message):
            errors.append({"step": step, "message": message})
        selected = {}
        for key, kinds, label, step in (("class_id", {"class"}, "class", "class"), ("species_id", {"race"}, "species", "origin"), ("background_id", {"background"}, "background", "origin")):
            value = self.selected(db, auth, row["version"], payload[key], kinds)
            if not value:
                error(step, f"Choose an available {label}.")
            selected[label] = value
            if value:
                review.extend(f"{value['name']}: {warning}" for warning in value["warnings"])
                if value["edition"] != "2024":
                    review.append(f"Review {value['name']} ({value['source']}) for compatibility with revised 2024 rules.")
        if payload["lineage_id"]:
            lineage = self.selected(db, auth, row["version"], payload["lineage_id"], {"subrace"})
            selected["lineage"] = lineage
            species = selected["species"]
            if not lineage or not species or lineage["raw"].get("raceName", "").casefold() != species["name"].casefold() or lineage["raw"].get("raceSource", "").casefold() != species["source"].casefold():
                error("origin", "The selected lineage must belong to the selected species and source.")
            else:
                review.append("Combine the lineage's traits with its parent species during manual review.")
        if not payload["name"]:
            error("review", "Enter a character name.")
        scores, boosts = payload["scores"], payload["boosts"]
        pool_row = db.execute("SELECT dice,created_at FROM creation_roll_pool WHERE campaign_id=? AND owner=?", (row["campaign_id"], self.roll_owner(row))).fetchone()
        pool = None
        if pool_row:
            dice = json.loads(pool_row["dice"])
            pool = {"dice": dice, "totals": [sum(sorted(roll)[1:]) for roll in dice], "created_at": pool_row["created_at"]}
        method = payload["method"]
        if method not in settings["methods"]:
            error("abilities", "This ability method is no longer allowed by the DM.")
        if method == "array" and Counter(scores.values()) != Counter(ARRAY):
            error("abilities", "Assign every standard-array score exactly once: 15, 14, 13, 12, 10, 8.")
        spent = sum(COST.get(n, 0) for n in scores.values())
        if method == "point_buy":
            if any(n not in COST for n in scores.values()):
                error("abilities", "Point-buy base scores must be between 8 and 15.")
            elif spent > 27:
                error("abilities", f"Point buy exceeds the budget by {spent - 27} points.")
            elif spent < 27:
                error("abilities", f"Allocate the remaining {27 - spent} point-buy points.")
        if method == "rolled" and (not pool or Counter(scores.values()) != Counter(pool["totals"])):
            error("abilities", "Record your ability rolls and assign each recorded total exactly once.")
        if method == "manual":
            review.append("Manually entered ability scores require DM review.")
        background = selected["background"]
        eligible = list(ABILITIES)
        if background and background["raw"].get("ability"):
            patterns = background["raw"]["ability"]
            eligible = sorted({SHORT[a] for p in patterns for a in p.get("choose", {}).get("weighted", {}).get("from", []) if a in SHORT})
            if not eligible:
                eligible = list(ABILITIES)
                review.append("Background ability adjustments use an unsupported format; verify the chosen increases.")
        if sorted(n for n in boosts.values() if n) not in ([1, 2], [1, 1, 1]) or any(boosts[a] and a not in eligible for a in ABILITIES):
            error("abilities", "Assign +2/+1 to two eligible abilities, or +1 to three eligible abilities.")
        final = {a: scores[a] + boosts[a] for a in ABILITIES}
        if any(n > 20 for n in final.values()):
            error("abilities", "Background increases cannot raise an ability above 20.")
        modifiers = {a: (n - 10) // 2 for a, n in final.items()}
        granted = {}
        for label in ("background", "species"):
            value = selected[label]
            if not value:
                continue
            for group in value["raw"].get("skillProficiencies") or []:
                for skill, flag in group.items():
                    if skill in SKILLS and flag is True:
                        granted.setdefault(skill, []).append(label)
                    elif skill not in SKILLS:
                        review.append(f"Resolve additional skill selections from {label}.")
        class_options, class_count = [], 0
        cls = selected["class"]
        if cls:
            groups = cls["raw"].get("startingProficiencies", {}).get("skills", [])
            if len(groups) == 1 and "choose" in groups[0]:
                choice = groups[0]["choose"]
                class_options = [s for s in choice.get("from", []) if s in SKILLS]
                class_count = choice.get("count", 1)
            elif groups:
                review.append("Resolve this class's proficiency selections manually.")
            if len(payload["class_skills"]) != class_count or any(s not in class_options for s in payload["class_skills"]):
                error("training", f"Choose {class_count} skills from your class's list.")
            for skill in payload["class_skills"]:
                if skill not in class_options:
                    continue
                if skill in granted:
                    review.append(f"Resolve overlapping proficiency in {SKILLS[skill]} during review.")
                granted.setdefault(skill, []).append("class")
        equipment_options = {}
        for label in ("class", "background"):
            value = selected[label]
            raw_equipment = value["raw"].get("startingEquipment") if value else None
            groups = raw_equipment.get("defaultData") if isinstance(raw_equipment, dict) else raw_equipment
            if not isinstance(groups, list) or len(groups) != 1 or not isinstance(groups[0], dict):
                equipment_options[label] = []
                if raw_equipment:
                    review.append(f"Resolve {label} starting equipment from the source details.")
                continue
            options = []
            for key, entries in groups[0].items():
                if not isinstance(entries, list):
                    continue
                parts = []
                for item in entries:
                    if not isinstance(item, dict):
                        continue
                    if "item" in item:
                        parts.append(f"{item.get('quantity', 1)} × {item['item'].split('|')[0]}")
                    elif "value" in item and isinstance(item["value"], int):
                        parts.append(f"{item['value'] / 100:g} gp")
                    elif "special" in item:
                        parts.append(str(item["special"]))
                    elif "equipmentType" in item:
                        parts.append(f"Choose {item['equipmentType']} (review)")
                    else:
                        parts.append("Additional choice (review)")
                options.append({"id": key, "label": ", ".join(parts) or "Consult source details"})
            equipment_options[label] = options
            chosen = payload.get("equipment", {}).get(label, "")
            if options and chosen not in {option["id"] for option in options}:
                error("equipment", f"Choose {label} starting equipment.")
            if any("review" in option["label"].lower() for option in options if option["id"] == chosen):
                review.append(f"Resolve the remaining {label} equipment choices with the DM.")
        level_one_features = []
        if cls:
            for feature in cls["raw"].get("classFeatures") or []:
                ref = feature if isinstance(feature, str) else feature.get("classFeature", "") if isinstance(feature, dict) else ""
                parts = ref.split("|")
                if len(parts) >= 4 and parts[3] == "1":
                    level_one_features.append({"name": parts[0], "source": parts[2]})
        for label in ("species", "background"):
            value = selected[label]
            if value and value["raw"].get("feats"):
                review.append(f"Resolve feats granted by {value['name']} in the Features step.")
            if value and value["raw"].get("languageProficiencies"):
                review.append(f"Resolve languages granted by {value['name']} in the Features step.")
        languages = []
        for language_id in payload.get("language_ids", []):
            language = self.selected(db, auth, row["version"], language_id, {"language"})
            if not language or language["raw"].get("type") != "standard":
                error("features", "Choose available standard languages for your origin.")
                continue
            languages.append({"id": language["id"], "name": language["name"], "source": language["source"]})
        if len(languages) != 2 or len({language["name"].casefold() for language in languages}) != 2 or any(language["name"].casefold() == "common" for language in languages):
            error("features", "Choose two different standard languages in addition to Common.")
        feats = []
        feat_count = 0
        for label in ("species", "background"):
            value = selected[label]
            for group in (value["raw"].get("feats") or []) if value else []:
                if not isinstance(group, dict):
                    continue
                for key, rule in group.items():
                    if key == "anyFromCategory" and isinstance(rule, dict):
                        feat_count += rule.get("count", 1)
                    elif rule is True:
                        name, _, source = key.partition("|")
                        feats.append({"name": name, "source": source or value["source"], "origin": label})
                    else:
                        review.append(f"Resolve {label} feat choices from the source details.")
        for feat_id in payload.get("feat_ids", []):
            feat = self.selected(db, auth, row["version"], feat_id, {"feat"})
            if not feat:
                error("features", "A selected feat is unavailable in this campaign.")
                continue
            if feat["raw"].get("category") != "O":
                error("features", f"{feat['name']} is not an Origin feat.")
            feats.append({"id": feat["id"], "name": feat["name"], "source": feat["source"], "origin": "choice"})
        if len(payload.get("feat_ids", [])) != feat_count:
            error("features", f"Choose {feat_count} Origin feats granted by your species or background.")
        if cls and (cls["raw"].get("cantripProgression") or cls["raw"].get("preparedSpellsProgression") or cls["raw"].get("spellsKnownProgression")):
            review.append("Verify spell selections and counts against the class source before finalization.")
        spell_limits = {"cantrips": 0, "level_one": 0}
        if cls:
            raw_class = cls["raw"]
            for field, target in (("cantripProgression", "cantrips"), ("preparedSpellsProgression", "level_one"), ("spellsKnownProgression", "level_one")):
                values = raw_class.get(field)
                if isinstance(values, list) and values and type(values[0]) is int:
                    spell_limits[target] = max(spell_limits[target], values[0])
        spells = []
        for spell_id in payload.get("spell_ids", []):
            spell = self.selected(db, auth, row["version"], spell_id, {"spell"})
            if not spell:
                error("spells", "A selected spell is unavailable in this catalog or campaign.")
                continue
            level = spell["raw"].get("level")
            if type(level) is not int or level not in (0, 1):
                error("spells", f"{spell['name']} is not a cantrip or level-one spell.")
            spells.append({"id": spell["id"], "name": spell["name"], "source": spell["source"], "level": level})
        for level, limit, label in ((0, spell_limits["cantrips"], "cantrips"), (1, spell_limits["level_one"], "level-one spells")):
            count = sum(spell["level"] == level for spell in spells)
            if count > limit:
                review.append(f"{count} {label} are selected; the class grants {limit}. Verify additional origin grants.")
            elif limit and count < limit:
                error("spells", f"Choose {limit - count} more {label} for this class.")
        if spells:
            review.append("Confirm every selected spell is on the class or origin spell list; catalog spell records do not contain class eligibility.")
        return {"errors": errors, "review": list(dict.fromkeys(review)), "eligible_boosts": eligible,
                "scores": final, "modifiers": modifiers, "points_spent": spent if method == "point_buy" else None,
                "class_skill_options": class_options, "class_skill_count": class_count,
                "skill_grants": granted, "roll_pool": pool, "policy": settings,
                "equipment_options": equipment_options, "level_one_features": level_one_features,
                "spell_limits": spell_limits, "spells": spells, "languages": languages, "feats": feats, "feat_choice_count": feat_count,
                "selected": {key: {k: v for k, v in value.items() if k != "raw"} if value else None for key, value in selected.items()},
                "can_finalize": not errors, "foundation_complete": not errors}

    def get(self, auth, draft_id):
        with self.connect() as db:
            row = self.owned(db, auth, draft_id)
            payload = json.loads(row["payload"])
            payload.setdefault("equipment", {"class": "", "background": ""})
            payload.setdefault("feature_choices", "")
            payload.setdefault("spell_choices", "")
            payload.setdefault("spell_ids", [])
            payload.setdefault("language_ids", [])
            payload.setdefault("feat_ids", [])
            result = {"id": row["id"], "revision": row["revision"], "version": row["version"], "draft": payload,
                      "updated_at": row["updated_at"], "preview": self.evaluate(db, auth, row, payload)}
            if db.execute("SELECT 1 FROM creation_portrait WHERE draft_id=?", (draft_id,)).fetchone():
                result["portrait_url"] = f"/api/dnd/creation/drafts/{draft_id}/portrait"
            if auth["role"] == "warden":
                finalized = db.execute("SELECT character_id FROM creation_finalization WHERE draft_id=?", (draft_id,)).fetchone()
                player_id = row["owner"][5:] if row["owner"].startswith("user:") else None
                target = db.execute("SELECT id,name FROM character WHERE campaign_id=? AND discord_user_id=?", (auth["campaign_id"], player_id)).fetchone() if player_id else None
                if target:
                    DndStore._ensure(db, target["id"])
                    sheet = db.execute("SELECT revision FROM dnd_character WHERE character_id=?", (target["id"],)).fetchone()
                    result["target"] = {"id": target["id"], "name": target["name"], "revision": sheet["revision"]}
                result["finalized_character_id"] = finalized["character_id"] if finalized else None
            return result

    def preview(self, auth, draft_id, body):
        payload = self.clean(body.get("draft") if isinstance(body, dict) else None)
        with self.connect() as db:
            row = self.owned(db, auth, draft_id)
            return self.evaluate(db, auth, row, payload)

    def options(self, auth, draft_id, kind, query="", source="", edition="", offset=0):
        if kind not in {"class", "race", "subrace", "background", "spell", "language", "feat"}:
            raise DndError("Unsupported creation category")
        with self.connect() as db:
            row = self.owned(db, auth, draft_id)
            version = row["version"]
        return self.search(auth, query=query, kind=kind, source=source, edition=edition, offset=offset, version=version)

    def finalize(self, auth, draft_id, body):
        """DM approval applies a validated draft once, preserving the prior sheet."""
        if auth.get("role") != "warden":
            raise DndError("Only the DM can approve a character draft", 403)
        if not isinstance(body, dict) or type(body.get("revision")) is not int:
            raise DndError("Draft revision is required")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = self.owned(db, auth, draft_id)
            prior = db.execute("SELECT character_id FROM creation_finalization WHERE draft_id=?", (draft_id,)).fetchone()
            if prior:
                return {"character_id": prior["character_id"], "already_finalized": True}
            if row["revision"] != body["revision"]:
                raise DndError("Draft changed; reload before approving", 409)
            payload = self.clean(json.loads(row["payload"]))
            preview = self.evaluate(db, auth, row, payload)
            if preview["errors"]:
                raise DndError("Resolve all draft errors before approval", 409)
            if preview["review"] and not body.get("reviewed") is True:
                raise DndError("Confirm manual review of source-dependent choices", 409)
            player_id = row["owner"][5:] if row["owner"].startswith("user:") else None
            existing = db.execute("SELECT * FROM character WHERE campaign_id=? AND discord_user_id=?", (auth["campaign_id"], player_id)).fetchone() if player_id else None
            if existing:
                character_id = existing["id"]
                DndStore._ensure(db, character_id)
                card = db.execute("SELECT * FROM dnd_character WHERE character_id=?", (character_id,)).fetchone()
                if body.get("target_revision") != card["revision"]:
                    raise DndError("Live sheet changed; reload before approving", 409)
                if body.get("replace_existing") is not True:
                    raise DndError("Confirm replacement of the existing character sheet", 409)
                snapshot = json.dumps({"character": dict(existing), "sheet": dict(card)})
            else:
                if body.get("target_revision") is not None:
                    raise DndError("The target character changed; reload", 409)
                snapshot = json.dumps({"character": None, "sheet": None})
                db.execute("INSERT INTO character(campaign_id,discord_user_id,name,player_token_hash,created_at) VALUES(?,?,?,?,?)",
                           (auth["campaign_id"], None, payload["name"], secrets.token_hex(32), _now()))
                character_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
                DndStore._ensure(db, character_id)
            cls = self.selected(db, auth, row["version"], payload["class_id"], {"class"})
            species = self.selected(db, auth, row["version"], payload["species_id"], {"race"})
            background = self.selected(db, auth, row["version"], payload["background_id"], {"background"})
            con = preview["modifiers"]["constitution"]
            hit_die = cls["raw"].get("hd", {}).get("faces", 8)
            hp = max(1, hit_die + con) if type(hit_die) is int else 10
            skill_training = {SKILLS[name]: {"tier": 1, "adjustment": 0, "override": None} for name in preview["skill_grants"]}
            save_training = {SHORT[name]: {"tier": 1, "adjustment": 0, "override": None} for name in cls["raw"].get("proficiency", []) if name in SHORT}
            inventory = []
            for label, origin in (("class", cls), ("background", background)):
                data = origin["raw"].get("startingEquipment")
                groups = data.get("defaultData") if isinstance(data, dict) else data
                if not isinstance(groups, list) or len(groups) != 1:
                    continue
                for item in groups[0].get(payload["equipment"][label], []):
                    if "item" in item:
                        inventory.append({"name": item["item"].split("|")[0], "quantity": item.get("quantity", 1), "notes": label})
                    elif "special" in item:
                        inventory.append({"name": str(item["special"]), "quantity": 1, "notes": label})
                    elif "value" in item:
                        inventory.append({"name": "Gold pieces", "quantity": item["value"] / 100, "notes": label})
            features = [{"name": feature["name"], "notes": f"{feature['source']} · class"} for feature in preview["level_one_features"]]
            features.extend({"name": feat["name"], "notes": f"{feat['source']} · {feat['origin']}"} for feat in preview["feats"])
            spells = [{"name": spell["name"], "level": spell["level"], "notes": spell["source"]} for spell in preview["spells"]]
            caster = cls["raw"].get("casterProgression")
            first_level_slots = {"full": 2, "half": 2, "artificer": 2, "pact": 1}.get(caster, 0)
            spell_ability = SHORT.get(cls["raw"].get("spellcastingAbility"))
            spell_modifier = preview["modifiers"].get(spell_ability, 0)
            identity = {"species": species["name"], "class_name": cls["name"], "background": background["name"], "level": "1"}
            fields = {"ability_scores_json": preview["scores"], "abilities_json": preview["modifiers"],
                      "skill_training_json": skill_training, "save_training_json": save_training,
                      "identity_json": identity, "inventory_json": inventory, "features_json": features,
                      "spells_json": spells, "spell_slots_json": {"1": {"current": first_level_slots, "max": first_level_slots}} if first_level_slots else {},
                      "background_json": {"source": background["source"], "notes": payload["feature_choices"]},
                      "training_json": {"languages": ", ".join(["Common", *(language["name"] for language in preview["languages"])]),
                                        "feature_choices": payload["feature_choices"], "spell_choices": payload["spell_choices"]}}
            assignments = ",".join(f"{column}=?" for column in fields)
            db.execute(f"UPDATE dnd_character SET {assignments},proficiency_bonus=2,initiative_modifier=?,spell_save_dc=?,spell_attack_modifier=?,revision=revision+1,updated_at=? WHERE character_id=?",
                       [*(json.dumps(value) for value in fields.values()), preview["modifiers"]["dexterity"], 10 + spell_modifier, 2 + spell_modifier, _now(), character_id])
            db.execute("UPDATE character SET name=?,class_name=?,hp=?,max_hp=? WHERE id=?", (payload["name"], cls["name"], hp, hp, character_id))
            db.execute("INSERT INTO creation_finalization VALUES(?,?,?,?)", (draft_id, character_id, snapshot, _now()))
            return {"character_id": character_id, "already_finalized": False}

    def upload_portrait(self, auth, draft_id, data):
        if len(data) > 3 * 1024 * 1024:
            raise DndError("Portrait must be 3 MB or smaller")
        try:
            with Image.open(io.BytesIO(data)) as original:
                if original.format not in {"PNG", "JPEG", "WEBP"} or original.width > 8000 or original.height > 8000 or original.width * original.height > 20_000_000:
                    raise DndError("Use a PNG, JPEG, or WebP portrait up to 20 megapixels")
                original.load()
                image = ImageOps.fit(ImageOps.exif_transpose(original).convert("RGB"), (512, 512), method=Image.Resampling.LANCZOS)
                output = io.BytesIO()
                image.save(output, format="JPEG", quality=88)
        except (UnidentifiedImageError, OSError, ValueError) as error:
            raise DndError("Invalid portrait image") from error
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            self.owned(db, auth, draft_id)
            db.execute("INSERT OR REPLACE INTO creation_portrait VALUES(?,?,?)", (draft_id, output.getvalue(), _now()))
        return {"portrait_url": f"/api/dnd/creation/drafts/{draft_id}/portrait"}

    def portrait(self, auth, draft_id):
        with self.connect() as db:
            self.owned(db, auth, draft_id)
            row = db.execute("SELECT image FROM creation_portrait WHERE draft_id=?", (draft_id,)).fetchone()
            if not row:
                raise DndError("Portrait not found", 404)
            return bytes(row["image"])

    def character_portrait(self, auth, character_id):
        self.require_auth(auth)
        if auth["role"] != "warden" and auth.get("character_id") != character_id:
            raise DndError("Portrait not found", 404)
        with self.connect() as db:
            row = db.execute("SELECT p.image FROM creation_finalization f JOIN creation_portrait p ON p.draft_id=f.draft_id "
                             "JOIN character c ON c.id=f.character_id WHERE c.id=? AND c.campaign_id=? ORDER BY f.finalized_at DESC",
                             (character_id, auth["campaign_id"])).fetchone()
            if not row:
                raise DndError("Portrait not found", 404)
            return bytes(row["image"])

    def grant_item(self, auth, entry_id, body):
        """Give a catalog item to one campaign character, once per operation ID."""
        self.require_auth(auth)
        if auth["role"] != "warden":
            raise DndError("Only the DM can give reference items", 403)
        if not isinstance(body, dict):
            raise DndError("JSON object required")
        character_id = integer(body.get("character_id"), 1, 2**31 - 1, "Character ID")
        revision = integer(body.get("revision"), 1, 2**31 - 1, "Sheet revision")
        quantity = integer(body.get("quantity", 1), 1, 99, "Quantity")
        operation_id = body.get("operation_id")
        if not isinstance(operation_id, str) or not 1 <= len(operation_id) <= 100:
            raise DndError("An operation ID is required")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            actor = DndStore._actor(auth)
            prior = db.execute("SELECT response_json FROM dnd_request WHERE actor_key=? AND operation_id=?", (actor, operation_id)).fetchone()
            if prior:
                return json.loads(prior["response_json"])
            active = db.execute("SELECT version FROM reference_active WHERE singleton=1").fetchone()
            version = body.get("version") or (active["version"] if active else "")
            item = self.selected(db, auth, version, entry_id, {"item", "baseitem"})
            if not item:
                raise DndError("Reference item is unavailable in this campaign", 404)
            character = db.execute("SELECT id FROM character WHERE id=? AND campaign_id=?", (character_id, auth["campaign_id"])).fetchone()
            if not character:
                raise DndError("Character not found in this campaign", 404)
            DndStore._ensure(db, character_id)
            sheet = db.execute("SELECT revision,inventory_json FROM dnd_character WHERE character_id=?", (character_id,)).fetchone()
            if sheet["revision"] != revision:
                raise DndError("Character sheet changed; refresh and retry", 409)
            inventory = json.loads(sheet["inventory_json"])
            if len(inventory) >= 50:
                raise DndError("Character inventory is full", 409)
            granted = {"name": item["name"], "quantity": quantity,
                       "notes": f"Reference: {item['source']} · {item['id']}"}
            inventory.append(granted)
            db.execute("UPDATE dnd_character SET inventory_json=?,revision=revision+1,updated_at=? WHERE character_id=? AND revision=?",
                       (json.dumps(inventory), _now(), character_id, revision))
            result = {"character_id": character_id, "revision": revision + 1, "item": granted}
            db.execute("INSERT INTO dnd_request(actor_key,operation_id,response_json,created_at) VALUES(?,?,?,?)",
                       (actor, operation_id, json.dumps(result), _now()))
            return result
