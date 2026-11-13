"""D&D 5e (2024) combat-card persistence and server-side dice rolls."""

from __future__ import annotations

import json
import re
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator


DND_SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS dnd_character (
    character_id INTEGER PRIMARY KEY REFERENCES character(id) ON DELETE CASCADE,
    ruleset TEXT NOT NULL DEFAULT 'dnd_2024' CHECK(ruleset = 'dnd_2024'),
    revision INTEGER NOT NULL DEFAULT 1,
    armor_class INTEGER NOT NULL DEFAULT 10,
    speed INTEGER NOT NULL DEFAULT 30,
    initiative_modifier INTEGER NOT NULL DEFAULT 0,
    spell_save_dc INTEGER NOT NULL DEFAULT 10,
    spell_attack_modifier INTEGER NOT NULL DEFAULT 0,
    temp_hp INTEGER NOT NULL DEFAULT 0,
    death_successes INTEGER NOT NULL DEFAULT 0,
    death_failures INTEGER NOT NULL DEFAULT 0,
    heroic_inspiration INTEGER NOT NULL DEFAULT 0,
    concentrating INTEGER NOT NULL DEFAULT 0,
    exhaustion INTEGER NOT NULL DEFAULT 0,
    proficiency_bonus INTEGER NOT NULL DEFAULT 2,
    abilities_json TEXT NOT NULL DEFAULT '{}',
    ability_scores_json TEXT NOT NULL DEFAULT '{}',
    skills_json TEXT NOT NULL DEFAULT '{}',
    skill_training_json TEXT NOT NULL DEFAULT '{}',
    saves_json TEXT NOT NULL DEFAULT '{}',
    save_training_json TEXT NOT NULL DEFAULT '{}',
    attacks_json TEXT NOT NULL DEFAULT '[]',
    spells_json TEXT NOT NULL DEFAULT '[]',
    inventory_json TEXT NOT NULL DEFAULT '[]',
    spell_slots_json TEXT NOT NULL DEFAULT '{}',
    resources_json TEXT NOT NULL DEFAULT '[]',
    features_json TEXT NOT NULL DEFAULT '[]',
    action_reminders_json TEXT NOT NULL DEFAULT '{}',
    identity_json TEXT NOT NULL DEFAULT '{}',
    senses_json TEXT NOT NULL DEFAULT '{}',
    training_json TEXT NOT NULL DEFAULT '{}',
    background_json TEXT NOT NULL DEFAULT '{}',
    conditions_json TEXT NOT NULL DEFAULT '[]',
    notes TEXT NOT NULL DEFAULT '',
    dm_notes TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dnd_roll_event (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
    character_id INTEGER REFERENCES character(id) ON DELETE SET NULL,
    actor_name TEXT NOT NULL, label TEXT NOT NULL, kind TEXT NOT NULL,
    expression TEXT NOT NULL, dice_json TEXT NOT NULL, selected_json TEXT NOT NULL,
    modifier INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL,
    mode TEXT NOT NULL DEFAULT 'normal', audience TEXT NOT NULL DEFAULT 'public',
    roller_key TEXT NOT NULL DEFAULT '',
    parent_roll_id INTEGER REFERENCES dnd_roll_event(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS dnd_roll_campaign ON dnd_roll_event(campaign_id, id DESC);
CREATE TABLE IF NOT EXISTS dnd_request (
    actor_key TEXT NOT NULL, operation_id TEXT NOT NULL, response_json TEXT NOT NULL,
    created_at TEXT NOT NULL, PRIMARY KEY(actor_key, operation_id)
);
"""

ABILITIES = ("strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma")
SKILL_ABILITIES = {
    "Acrobatics": "dexterity", "Animal Handling": "wisdom", "Arcana": "intelligence",
    "Athletics": "strength", "Deception": "charisma", "History": "intelligence",
    "Insight": "wisdom", "Intimidation": "charisma", "Investigation": "intelligence",
    "Medicine": "wisdom", "Nature": "intelligence", "Perception": "wisdom",
    "Performance": "charisma", "Persuasion": "charisma", "Religion": "intelligence",
    "Sleight of Hand": "dexterity", "Stealth": "dexterity", "Survival": "wisdom",
}
MODES = {"normal", "advantage", "disadvantage"}
AUDIENCES = {"public", "private", "dm"}
ROLL_KINDS = {"ability", "skill", "save", "attack", "damage", "initiative", "custom"}
EXPRESSION = re.compile(r"^\s*(?:(\d{1,2})d(\d{1,4}))?\s*([+-]\s*\d{1,4})?\s*$", re.I)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _dump(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), sort_keys=True)


class DndError(ValueError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


class DndStore:
    JSON_FIELDS = {
        "abilities": "abilities_json", "ability_scores": "ability_scores_json",
        "skills": "skills_json", "skill_training": "skill_training_json",
        "saves": "saves_json", "save_training": "save_training_json",
        "attacks": "attacks_json", "spells": "spells_json", "inventory": "inventory_json",
        "spell_slots": "spell_slots_json", "resources": "resources_json",
        "features": "features_json", "action_reminders": "action_reminders_json",
        "identity": "identity_json", "senses": "senses_json", "training": "training_json",
        "background": "background_json", "conditions": "conditions_json",
    }
    INT_FIELDS = {
        "armor_class": (0, 99), "speed": (0, 999), "initiative_modifier": (-99, 99),
        "spell_save_dc": (0, 99), "spell_attack_modifier": (-99, 99), "temp_hp": (0, 9999),
        "death_successes": (0, 3), "death_failures": (0, 3), "heroic_inspiration": (0, 1),
        "concentrating": (0, 1), "exhaustion": (0, 6), "proficiency_bonus": (0, 12),
    }

    def __init__(self, path: str):
        self.path = path
        with self.connect() as db:
            db.executescript(DND_SCHEMA)
            columns = {row["name"] for row in db.execute("PRAGMA table_info(dnd_character)")}
            additions = {
                "proficiency_bonus": "INTEGER NOT NULL DEFAULT 2",
                "ability_scores_json": "TEXT NOT NULL DEFAULT '{}'", "skill_training_json": "TEXT NOT NULL DEFAULT '{}'",
                "save_training_json": "TEXT NOT NULL DEFAULT '{}'", "spells_json": "TEXT NOT NULL DEFAULT '[]'",
                "inventory_json": "TEXT NOT NULL DEFAULT '[]'", "identity_json": "TEXT NOT NULL DEFAULT '{}'",
                "senses_json": "TEXT NOT NULL DEFAULT '{}'", "training_json": "TEXT NOT NULL DEFAULT '{}'",
                "background_json": "TEXT NOT NULL DEFAULT '{}'", "conditions_json": "TEXT NOT NULL DEFAULT '[]'",
                "dm_notes": "TEXT NOT NULL DEFAULT ''",
            }
            for name, definition in additions.items():
                if name not in columns:
                    db.execute(f"ALTER TABLE dnd_character ADD COLUMN {name} {definition}")
            roll_columns = {row["name"] for row in db.execute("PRAGMA table_info(dnd_roll_event)")}
            if "roller_key" not in roll_columns:
                db.execute("ALTER TABLE dnd_roll_event ADD COLUMN roller_key TEXT NOT NULL DEFAULT ''")

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys = ON")
        try:
            yield db
            db.commit()
        finally:
            db.close()

    @staticmethod
    def _require_dnd(auth: dict[str, Any]) -> None:
        if auth.get("game_system") != "dnd":
            raise DndError("D&D combat cards are only available in a D&D campaign", 403)

    @staticmethod
    def _actor(auth: dict[str, Any]) -> str:
        who = "dm" if auth["role"] == "warden" else f"character:{auth['character_id']}"
        return f"campaign:{auth['campaign_id']}:{who}"

    @staticmethod
    def _can_edit(auth: dict[str, Any], character_id: int) -> bool:
        return auth["role"] == "warden" or auth.get("character_id") == character_id

    def _character(self, db: sqlite3.Connection, auth: dict[str, Any], character_id: int) -> sqlite3.Row:
        row = db.execute("SELECT * FROM character WHERE id=? AND campaign_id=?", (character_id, auth["campaign_id"])).fetchone()
        if not row:
            raise DndError("Character not found", 404)
        return row

    @staticmethod
    def _ensure(db: sqlite3.Connection, character_id: int) -> None:
        db.execute("INSERT OR IGNORE INTO dnd_character(character_id,updated_at) VALUES(?,?)", (character_id, _now()))

    @classmethod
    def _doc(cls, row: sqlite3.Row, base: sqlite3.Row) -> dict[str, Any]:
        result = dict(row)
        for public, column in cls.JSON_FIELDS.items():
            result[public] = json.loads(result.pop(column) or ("[]" if public in {"attacks", "spells", "inventory", "resources", "features", "conditions"} else "{}"))
        result.update({"id": base["id"], "name": base["name"], "hp": base["hp"], "max_hp": base["max_hp"]})
        if not result.get("ability_scores") and result.get("abilities"):
            result["ability_scores"] = {ability: max(1, min(30, 10 + 2 * int(modifier))) for ability, modifier in result["abilities"].items()}
        return result

    @staticmethod
    def _visible_doc(auth: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
        if auth["role"] != "warden": result.pop("dm_notes", None)
        return result

    @staticmethod
    def _clean_json_field(key: str, value: Any) -> Any:
        """Keep user-authored card data flexible but bounded and JSON-safe."""
        if key in {"abilities", "ability_scores", "saves", "skills"}:
            if not isinstance(value, dict):
                raise DndError(f"{key} must be an object")
            result = {}
            for name, modifier in list(value.items())[:100]:
                try:
                    low, high = (1, 30) if key == "ability_scores" else (-99, 99)
                    result[str(name)[:80]] = max(low, min(high, int(modifier)))
                except (TypeError, ValueError) as error:
                    raise DndError(f"{key} modifiers must be integers") from error
            return result
        if key == "spell_slots":
            if not isinstance(value, dict):
                raise DndError("spell_slots must be an object")
            result = {}
            for level, pool in list(value.items())[:12]:
                if not isinstance(pool, dict):
                    raise DndError("Each spell-slot pool must be an object")
                maximum = max(0, min(99, int(pool.get("max", 0))))
                result[str(level)[:20]] = {"current": max(0, min(maximum, int(pool.get("current", 0)))), "max": maximum}
            return result
        if key in {"action_reminders", "identity", "senses", "training", "background"}:
            if not isinstance(value, dict):
                raise DndError("action_reminders must be an object")
            return {str(name)[:80]: str(note)[:1000] for name, note in list(value.items())[:20]}
        if key in {"skill_training", "save_training"}:
            if not isinstance(value, dict): raise DndError(f"{key} must be an object")
            clean = {}
            for name, entry in list(value.items())[:100]:
                if not isinstance(entry, dict): raise DndError(f"{key} entries must be objects")
                clean[str(name)[:80]] = {
                    "tier": max(0, min(2, int(entry.get("tier", 0)))),
                    "adjustment": max(-99, min(99, int(entry.get("adjustment", 0)))),
                    "override": None if entry.get("override") in (None, "") else max(-99, min(99, int(entry["override"]))),
                }
            return clean
        if key not in {"attacks", "spells", "inventory", "resources", "features", "conditions"} or not isinstance(value, list):
            raise DndError(f"{key} must be a list")
        clean = []
        for item in value[:50]:
            if not isinstance(item, dict):
                raise DndError(f"{key} entries must be objects")
            bounded = {str(name)[:80]: (str(entry)[:2000] if isinstance(entry, str) else
                          max(-9999, min(9999, int(entry))) if isinstance(entry, (int, float)) else bool(entry))
                          for name, entry in list(item.items())[:20]}
            if key == "resources":
                maximum = max(0, min(9999, int(bounded.get("max", 0))))
                bounded["max"] = maximum
                bounded["current"] = max(0, min(maximum, int(bounded.get("current", 0))))
            if key == "features" and "uses" in bounded:
                bounded["uses"] = max(0, min(9999, int(bounded["uses"])))
            if key == "attacks" and "bonus" in bounded:
                bounded["bonus"] = max(-99, min(99, int(bounded["bonus"])))
            clean.append(bounded)
        return clean

    def cards(self, auth: dict[str, Any]) -> list[dict[str, Any]]:
        self._require_dnd(auth)
        with self.connect() as db:
            if auth["role"] == "warden":
                bases = db.execute("SELECT * FROM character WHERE campaign_id=? ORDER BY name", (auth["campaign_id"],)).fetchall()
            else:
                bases = db.execute("SELECT * FROM character WHERE id=? AND campaign_id=?", (auth["character_id"], auth["campaign_id"])).fetchall()
            result = []
            for base in bases:
                self._ensure(db, base["id"])
                result.append(self._visible_doc(auth, self._doc(db.execute("SELECT * FROM dnd_character WHERE character_id=?", (base["id"],)).fetchone(), base)))
        return result

    def roster(self, auth: dict[str, Any]) -> list[dict[str, Any]]:
        """Campaign party summaries with no inventory, features, spells, or private notes."""
        self._require_dnd(auth)
        with self.connect() as db:
            bases = db.execute("SELECT * FROM character WHERE campaign_id=? ORDER BY name", (auth["campaign_id"],)).fetchall()
            result = []
            for base in bases:
                self._ensure(db, base["id"])
                full = self._doc(db.execute("SELECT * FROM dnd_character WHERE character_id=?", (base["id"],)).fetchone(), base)
                scores = full.get("ability_scores", {})
                passives = {}
                for skill in ("Perception", "Investigation", "Insight"):
                    ability = SKILL_ABILITIES[skill]; training = full.get("skill_training", {}).get(skill, {})
                    value = self._ability_modifier(int(scores.get(ability, 10))) + int(full.get("proficiency_bonus", 2)) * int(training.get("tier", 0)) + int(training.get("adjustment", 0))
                    passives[skill] = 10 + (value if training.get("override") is None else int(training["override"]))
                result.append({
                    "id": base["id"], "name": base["name"], "hp": base["hp"], "max_hp": base["max_hp"],
                    "armor_class": full["armor_class"], "speed": full["speed"], "identity": full.get("identity", {}),
                    "conditions": full.get("conditions", []), "exhaustion": full["exhaustion"],
                    "death_successes": full["death_successes"], "death_failures": full["death_failures"],
                    "passives": passives, "can_open": auth["role"] == "warden" or auth.get("character_id") == base["id"],
                })
        return result

    def update_card(self, auth: dict[str, Any], character_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        self._require_dnd(auth)
        if not isinstance(payload, dict):
            raise DndError("JSON object required")
        if not self._can_edit(auth, character_id):
            raise DndError("You cannot edit this character", 403)
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            base = self._character(db, auth, character_id)
            self._ensure(db, character_id)
            row = db.execute("SELECT * FROM dnd_character WHERE character_id=?", (character_id,)).fetchone()
            expected = int(payload.get("revision", -1))
            if expected != row["revision"]:
                raise DndError("Character changed; refresh and retry", 409)
            updates, values = [], []
            for key, (low, high) in self.INT_FIELDS.items():
                if key in payload:
                    updates.append(f"{key}=?"); values.append(max(low, min(high, int(payload[key]))))
            for key, column in self.JSON_FIELDS.items():
                if key in payload:
                    value = self._clean_json_field(key, payload[key])
                    updates.append(f"{column}=?"); values.append(_dump(value))
            if "notes" in payload:
                updates.append("notes=?"); values.append(str(payload["notes"])[:10000])
            if "dm_notes" in payload:
                if auth["role"] != "warden": raise DndError("Only the DM can edit private notes", 403)
                updates.append("dm_notes=?"); values.append(str(payload["dm_notes"])[:10000])
            hp, max_hp = base["hp"], base["max_hp"]
            if "max_hp" in payload:
                max_hp = max(1, min(9999, int(payload["max_hp"])))
            if "hp" in payload:
                hp = max(0, min(max_hp, int(payload["hp"])))
            if "hp" in payload or "max_hp" in payload:
                db.execute("UPDATE character SET hp=?,max_hp=? WHERE id=?", (min(hp, max_hp), max_hp, character_id))
                if not updates:
                    updates.append("ruleset=ruleset")
            if updates:
                values.extend((_now(), character_id, expected))
                changed = db.execute(f"UPDATE dnd_character SET {','.join(updates)},revision=revision+1,updated_at=? WHERE character_id=? AND revision=?", values).rowcount
                if not changed:
                    raise DndError("Character changed; refresh and retry", 409)
            base = self._character(db, auth, character_id)
            row = db.execute("SELECT * FROM dnd_character WHERE character_id=?", (character_id,)).fetchone()
        return self._visible_doc(auth, self._doc(row, base))

    def resource_delta(self, auth: dict[str, Any], character_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        """Atomic, bounded, retry-safe changes for HP and common combat resources."""
        self._require_dnd(auth)
        if not isinstance(payload, dict):
            raise DndError("JSON object required")
        if not self._can_edit(auth, character_id):
            raise DndError("You cannot edit this character", 403)
        operation_id = str(payload.get("operation_id", ""))[:100]
        if not operation_id:
            raise DndError("operation_id is required")
        field = str(payload.get("field", ""))
        allowed = {"hp", "temp_hp", "death_successes", "death_failures", "heroic_inspiration", "exhaustion"}
        if field not in allowed:
            raise DndError("Unsupported resource")
        delta = max(-9999, min(9999, int(payload.get("delta", 0))))
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            prior = db.execute("SELECT response_json FROM dnd_request WHERE actor_key=? AND operation_id=?", (self._actor(auth), operation_id)).fetchone()
            if prior:
                return json.loads(prior["response_json"])
            base = self._character(db, auth, character_id); self._ensure(db, character_id)
            if field == "hp":
                value = max(0, min(base["max_hp"], base["hp"] + delta))
                db.execute("UPDATE character SET hp=? WHERE id=?", (value, character_id))
                db.execute("UPDATE dnd_character SET revision=revision+1,updated_at=? WHERE character_id=?", (_now(), character_id))
            else:
                low, high = self.INT_FIELDS[field]
                row = db.execute(f"SELECT {field} FROM dnd_character WHERE character_id=?", (character_id,)).fetchone()
                value = max(low, min(high, row[field] + delta))
                db.execute(f"UPDATE dnd_character SET {field}=?,revision=revision+1,updated_at=? WHERE character_id=?", (value, _now(), character_id))
            base = self._character(db, auth, character_id)
            row = db.execute("SELECT * FROM dnd_character WHERE character_id=?", (character_id,)).fetchone()
            result = self._visible_doc(auth, self._doc(row, base))
            db.execute("INSERT INTO dnd_request VALUES(?,?,?,?)", (self._actor(auth), operation_id, _dump(result), _now()))
        return result

    @staticmethod
    def _ability_modifier(score: int) -> int:
        return (score - 10) // 2

    def roll_sheet_field(self, auth: dict[str, Any], character_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        """Resolve a sheet modifier from canonical persisted values before rolling."""
        self._require_dnd(auth)
        if not self._can_edit(auth, character_id): raise DndError("You cannot roll for this character", 403)
        field_type = str(payload.get("field_type", "")); name = str(payload.get("name", ""))[:80]
        with self.connect() as db:
            base = self._character(db, auth, character_id); self._ensure(db, character_id)
            card = self._doc(db.execute("SELECT * FROM dnd_character WHERE character_id=?", (character_id,)).fetchone(), base)
        scores = card.get("ability_scores") or {}
        if field_type == "ability":
            ability = name.lower()
            if ability not in ABILITIES: raise DndError("Unknown ability")
            modifier = self._ability_modifier(int(scores.get(ability, 10))) if scores else int(card.get("abilities", {}).get(ability, 0))
            label, kind = f"{ability.title()} check", "ability"
        elif field_type == "save":
            ability = name.lower()
            if ability not in ABILITIES: raise DndError("Unknown saving throw")
            base_modifier = self._ability_modifier(int(scores.get(ability, 10))) if scores else int(card.get("abilities", {}).get(ability, 0))
            training = card.get("save_training", {}).get(ability, {})
            computed = base_modifier + int(card.get("proficiency_bonus", 2)) * min(1, int(training.get("tier", 0))) + int(training.get("adjustment", 0))
            modifier = computed if training.get("override") is None else int(training["override"])
            label, kind = f"{ability.title()} save", "save"
        elif field_type == "skill":
            canonical = next((skill for skill in SKILL_ABILITIES if skill.lower() == name.lower()), None)
            if not canonical: raise DndError("Unknown skill")
            ability = SKILL_ABILITIES[canonical]
            base_modifier = self._ability_modifier(int(scores.get(ability, 10))) if scores else int(card.get("abilities", {}).get(ability, 0))
            training = card.get("skill_training", {}).get(canonical, {})
            computed = base_modifier + int(card.get("proficiency_bonus", 2)) * int(training.get("tier", 0)) + int(training.get("adjustment", 0))
            modifier = computed if training.get("override") is None else int(training["override"])
            label, kind = f"{canonical} check", "skill"
        else:
            raise DndError("Unknown sheet roll type")
        one_time = max(-99, min(99, int(payload.get("bonus", 0))))
        return self.roll(auth, character_id, {
            "operation_id": payload.get("operation_id"), "kind": kind, "label": label,
            "expression": f"1d20{modifier + one_time:+d}", "mode": payload.get("mode", "normal"),
            "audience": payload.get("audience", "public"),
        })

    @staticmethod
    def _parse_expression(expression: str) -> tuple[int, int, int, str]:
        expression = str(expression)[:40]
        match = EXPRESSION.fullmatch(expression)
        if not match or not (match.group(1) or match.group(3)):
            raise DndError("Use a bounded expression such as 2d6+3")
        count = int(match.group(1) or 0); sides = int(match.group(2) or 0)
        modifier = int((match.group(3) or "0").replace(" ", ""))
        if count > 50 or sides > 1000 or (count and sides < 2) or abs(modifier) > 1000:
            raise DndError("Dice expression exceeds the allowed limits")
        normalized = (f"{count}d{sides}" if count else "") + (f"{modifier:+d}" if modifier else "")
        return count, sides, modifier, normalized

    def roll(self, auth: dict[str, Any], character_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        self._require_dnd(auth)
        if not isinstance(payload, dict):
            raise DndError("JSON object required")
        if not self._can_edit(auth, character_id):
            raise DndError("You cannot roll for this character", 403)
        operation_id = str(payload.get("operation_id", ""))[:100]
        if not operation_id:
            raise DndError("operation_id is required")
        kind = str(payload.get("kind", "custom")); mode = str(payload.get("mode", "normal")); audience = str(payload.get("audience", "public"))
        if kind not in ROLL_KINDS or mode not in MODES or audience not in AUDIENCES:
            raise DndError("Invalid roll options")
        if audience == "dm" and auth["role"] != "warden":
            raise DndError("Only the DM can make DM-only rolls", 403)
        expression = str(payload.get("expression", "1d20"))
        count, sides, modifier, normalized = self._parse_expression(expression)
        if mode != "normal" and not (count == 1 and sides == 20):
            raise DndError("Advantage and disadvantage apply only to a single d20")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            prior = db.execute("SELECT response_json FROM dnd_request WHERE actor_key=? AND operation_id=?", (self._actor(auth), operation_id)).fetchone()
            if prior:
                return json.loads(prior["response_json"])
            character = self._character(db, auth, character_id)
            dice = [secrets.randbelow(sides) + 1 for _ in range(count)] if count else []
            if mode != "normal":
                dice.append(secrets.randbelow(20) + 1)
            selected = dice
            if mode == "advantage": selected = [max(dice)]
            if mode == "disadvantage": selected = [min(dice)]
            total = sum(selected) + modifier
            parent = payload.get("parent_roll_id")
            if parent is not None:
                source = db.execute("SELECT * FROM dnd_roll_event WHERE id=? AND campaign_id=? AND character_id=?", (int(parent), auth["campaign_id"], character_id)).fetchone()
                if not source:
                    raise DndError("Original roll not found", 404)
                self._ensure(db, character_id)
                inspired = db.execute("SELECT heroic_inspiration FROM dnd_character WHERE character_id=?", (character_id,)).fetchone()[0]
                if not inspired:
                    raise DndError("Heroic Inspiration is not available", 409)
                db.execute("UPDATE dnd_character SET heroic_inspiration=0,revision=revision+1,updated_at=? WHERE character_id=?", (_now(), character_id))
            created = _now(); label = str(payload.get("label", kind.title()))[:100] or kind.title()
            roller_key = self._actor(auth)
            event_id = db.execute("INSERT INTO dnd_roll_event(campaign_id,character_id,actor_name,label,kind,expression,dice_json,selected_json,modifier,total,mode,audience,roller_key,parent_roll_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (auth["campaign_id"], character_id, character["name"], label, kind, normalized, _dump(dice), _dump(selected), modifier, total, mode, audience, roller_key, parent, created)).lastrowid
            result = {"id": event_id, "character_id": character_id, "actor_name": character["name"], "label": label, "kind": kind, "expression": normalized, "dice": dice, "selected": selected, "modifier": modifier, "total": total, "mode": mode, "audience": audience, "is_own": True, "parent_roll_id": parent, "created_at": created}
            db.execute("INSERT INTO dnd_request VALUES(?,?,?,?)", (self._actor(auth), operation_id, _dump(result), _now()))
        return result

    def rolls(self, auth: dict[str, Any], limit: int = 50) -> list[dict[str, Any]]:
        self._require_dnd(auth)
        with self.connect() as db:
            rows = db.execute("SELECT * FROM dnd_roll_event WHERE campaign_id=? ORDER BY id DESC LIMIT ?", (auth["campaign_id"], min(100, max(1, limit)))).fetchall()
        result = []
        for row in rows:
            if auth["role"] != "warden" and row["audience"] != "public" and row["character_id"] != auth["character_id"]:
                continue
            item = dict(row); item["dice"] = json.loads(item.pop("dice_json")); item["selected"] = json.loads(item.pop("selected_json")); item["is_own"] = item.pop("roller_key", "") == self._actor(auth); result.append(item)
        return result
