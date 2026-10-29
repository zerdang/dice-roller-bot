"""Persistence and authorization for the tabletop companion.

The companion deliberately uses its own SQLite database.  That keeps the web
feature isolated from the bot's existing migrations and makes it easy to back
up or remove without touching roll statistics.
"""

from __future__ import annotations

import hashlib
import json
import re
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator


SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS campaign (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    owner_discord_user_id TEXT,
    warden_token_hash TEXT NOT NULL,
    map_visibility_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS character (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
    discord_user_id TEXT,
    name TEXT NOT NULL,
    player_token_hash TEXT NOT NULL UNIQUE,
    hp INTEGER NOT NULL DEFAULT 10,
    max_hp INTEGER NOT NULL DEFAULT 10,
    wounds INTEGER NOT NULL DEFAULT 0,
    max_wounds INTEGER NOT NULL DEFAULT 2,
    stress INTEGER NOT NULL DEFAULT 2,
    resolve INTEGER NOT NULL DEFAULT 0,
    class_name TEXT NOT NULL DEFAULT '',
    stats_json TEXT NOT NULL DEFAULT '{}',
    skills_json TEXT NOT NULL DEFAULT '[]',
    public_notes TEXT NOT NULL DEFAULT '',
    warden_notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS character_discord_campaign
    ON character(campaign_id, discord_user_id)
    WHERE discord_user_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS inventory_item (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id INTEGER NOT NULL REFERENCES character(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'item',
    quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity >= 0),
    details TEXT NOT NULL DEFAULT '',
    equipped INTEGER NOT NULL DEFAULT 0,
    damage TEXT NOT NULL DEFAULT '',
    range_band TEXT NOT NULL DEFAULT '',
    wound TEXT NOT NULL DEFAULT '',
    shots TEXT NOT NULL DEFAULT '',
    ammo INTEGER,
    ammo_max INTEGER,
    armor_points INTEGER,
    damage_reduction INTEGER,
    uses INTEGER,
    uses_max INTEGER,
    special TEXT NOT NULL DEFAULT '',
    catalog_key TEXT NOT NULL DEFAULT '',
    cost INTEGER,
    position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS roll_event (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
    discord_user_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    expression TEXT NOT NULL,
    result TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS turn_entry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
    character_id INTEGER REFERENCES character(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('crew', 'enemy')),
    position INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS turn_entry_character
    ON turn_entry(character_id) WHERE character_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS roll_event_campaign_created
    ON roll_event(campaign_id, id DESC);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _token() -> str:
    return secrets.token_urlsafe(32)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


ROLLABLE_STATS = {
    name.lower(): name
    for name in ("Strength", "Speed", "Intellect", "Combat", "Sanity", "Fear", "Body", "Armor")
}

SKILL_BONUSES = {
    skill: bonus
    for bonus, skills in (
        (10, ("chemistry", "athletics", "rimwise", "theology", "archaeology", "art", "mathematics",
              "zero-g", "computers", "jury-rigging", "industrial-equipment", "geology", "botany",
              "zoology", "linguistics", "pharmacology", "wilderness-survival", "hand-to-hand", "firearms")),
        (15, ("physics", "piloting", "hacking", "mechanical-repair", "asteroid-mining", "ecology",
              "field-medicine", "pathology", "psychology", "military-training", "mysticism")),
        (20, ("hyperspace", "artificial-intelligence", "engineering", "robotics", "cybernetics", "command",
              "planetology", "surgery", "exobiology", "sophontology", "explosives", "xenoesotericism")),
    )
    for skill in skills
}
CLASS_SKILLS = {
    "marine": {"military-training", "athletics"},
    "android": {"linguistics", "computers", "mathematics"},
    "teamster": {"industrial-equipment", "zero-g"},
    "scientist": set(),
}
ROLL_MODES = {"normal", "advantage", "disadvantage"}


class CompanionStore:
    def __init__(self, path: str):
        self.path = path
        with self.connect() as db:
            db.executescript(SCHEMA)
            self._migrate_campaign(db)
            self._migrate_character(db)
            self._migrate_inventory(db)

    @staticmethod
    def _migrate_campaign(db: sqlite3.Connection) -> None:
        columns = {row["name"] for row in db.execute("PRAGMA table_info(campaign)")}
        if "owner_discord_user_id" not in columns:
            db.execute("ALTER TABLE campaign ADD COLUMN owner_discord_user_id TEXT")
        if "map_visibility_json" not in columns:
            db.execute("ALTER TABLE campaign ADD COLUMN map_visibility_json TEXT NOT NULL DEFAULT '{}'")

    @staticmethod
    def _migrate_character(db: sqlite3.Connection) -> None:
        columns = {row["name"] for row in db.execute("PRAGMA table_info(character)")}
        adding_max_wounds = "max_wounds" not in columns
        additions = {
            "wounds": "INTEGER NOT NULL DEFAULT 0",
            "max_wounds": "INTEGER NOT NULL DEFAULT 2",
            "stress": "INTEGER NOT NULL DEFAULT 2",
            "resolve": "INTEGER NOT NULL DEFAULT 0",
            "class_name": "TEXT NOT NULL DEFAULT ''",
            "skills_json": "TEXT NOT NULL DEFAULT '[]'",
        }
        for name, declaration in additions.items():
            if name not in columns:
                db.execute(f"ALTER TABLE character ADD COLUMN {name} {declaration}")
        if adding_max_wounds:
            db.execute("UPDATE character SET max_wounds = 3 WHERE class_name IN ('marine', 'android')")

    @staticmethod
    def _migrate_inventory(db: sqlite3.Connection) -> None:
        """Add inventory fields without discarding campaigns made by older builds."""
        columns = {row["name"] for row in db.execute("PRAGMA table_info(inventory_item)")}
        additions = {
            "damage": "TEXT NOT NULL DEFAULT ''",
            "range_band": "TEXT NOT NULL DEFAULT ''",
            "wound": "TEXT NOT NULL DEFAULT ''",
            "shots": "TEXT NOT NULL DEFAULT ''",
            "ammo": "INTEGER",
            "ammo_max": "INTEGER",
            "armor_points": "INTEGER",
            "damage_reduction": "INTEGER",
            "uses": "INTEGER",
            "uses_max": "INTEGER",
            "special": "TEXT NOT NULL DEFAULT ''",
            "catalog_key": "TEXT NOT NULL DEFAULT ''",
            "cost": "INTEGER",
            "position": "INTEGER NOT NULL DEFAULT 0",
        }
        for name, declaration in additions.items():
            if name not in columns:
                db.execute(f"ALTER TABLE inventory_item ADD COLUMN {name} {declaration}")
        db.execute("UPDATE inventory_item SET position = id WHERE position = 0")

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

    def create_campaign(
        self, guild_id: str, name: str, owner_discord_user_id: str
    ) -> dict[str, Any] | None:
        """Create a campaign or update one owned by the requesting Discord user."""
        with self.connect() as db:
            existing = db.execute(
                "SELECT id, owner_discord_user_id FROM campaign WHERE guild_id = ?", (guild_id,)
            ).fetchone()
            if existing:
                if existing["owner_discord_user_id"] not in (None, owner_discord_user_id):
                    return None
                if existing["owner_discord_user_id"] is None:
                    # Claiming a pre-ownership campaign must revoke its old bearer link.
                    db.execute(
                        "UPDATE campaign SET name = ?, owner_discord_user_id = ?, warden_token_hash = ? "
                        "WHERE id = ?",
                        (name, owner_discord_user_id, _hash(_token()), existing["id"]),
                    )
                else:
                    db.execute(
                        "UPDATE campaign SET name = ? WHERE id = ?",
                        (name, existing["id"]),
                    )
                campaign_id = existing["id"]
            else:
                inaccessible_token = _token()
                campaign_id = db.execute(
                    "INSERT INTO campaign(guild_id, name, owner_discord_user_id, warden_token_hash, created_at) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (guild_id, name, owner_discord_user_id, _hash(inaccessible_token), _now()),
                ).lastrowid
            row = db.execute("SELECT * FROM campaign WHERE id = ?", (campaign_id,)).fetchone()
        return dict(row)

    def is_campaign_owner(self, guild_id: str, discord_user_id: str) -> bool:
        with self.connect() as db:
            row = db.execute(
                "SELECT 1 FROM campaign WHERE guild_id = ? AND owner_discord_user_id = ?",
                (guild_id, discord_user_id),
            ).fetchone()
        return bool(row)

    def rotate_warden_token(self, guild_id: str, discord_user_id: str) -> str | None:
        """Issue a new bearer credential only to the campaign's Discord owner."""
        token = _token()
        with self.connect() as db:
            changed = db.execute(
                "UPDATE campaign SET warden_token_hash = ? "
                "WHERE guild_id = ? AND owner_discord_user_id = ?",
                (_hash(token), guild_id, discord_user_id),
            ).rowcount
        return token if changed else None

    def create_or_rotate_player(
        self, guild_id: str, discord_user_id: str, name: str
    ) -> tuple[dict[str, Any], str] | None:
        token = _token()
        with self.connect() as db:
            campaign = db.execute(
                "SELECT id FROM campaign WHERE guild_id = ?", (guild_id,)
            ).fetchone()
            if not campaign:
                return None
            existing = db.execute(
                "SELECT id FROM character WHERE campaign_id = ? AND discord_user_id = ?",
                (campaign["id"], discord_user_id),
            ).fetchone()
            if existing:
                db.execute(
                    "UPDATE character SET name = ?, player_token_hash = ? WHERE id = ?",
                    (name, _hash(token), existing["id"]),
                )
                character_id = existing["id"]
            else:
                character_id = db.execute(
                    "INSERT INTO character(campaign_id, discord_user_id, name, player_token_hash, created_at) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (campaign["id"], discord_user_id, name, _hash(token), _now()),
                ).lastrowid
            row = db.execute("SELECT * FROM character WHERE id = ?", (character_id,)).fetchone()
        return dict(row), token

    def authorize(self, token: str) -> dict[str, Any] | None:
        token_hash = _hash(token)
        with self.connect() as db:
            campaign = db.execute(
                "SELECT * FROM campaign WHERE warden_token_hash = ?", (token_hash,)
            ).fetchone()
            if campaign:
                return {"role": "warden", "campaign_id": campaign["id"], "character_id": None}
            character = db.execute(
                "SELECT campaign_id, id FROM character WHERE player_token_hash = ?", (token_hash,)
            ).fetchone()
            if character:
                return {
                    "role": "player",
                    "campaign_id": character["campaign_id"],
                    "character_id": character["id"],
                }
        return None

    def dashboard(self, auth: dict[str, Any]) -> dict[str, Any]:
        with self.connect() as db:
            campaign = dict(db.execute(
                "SELECT id, guild_id, name FROM campaign WHERE id = ?", (auth["campaign_id"],)
            ).fetchone())
            if auth["role"] == "warden":
                rows = db.execute(
                    "SELECT * FROM character WHERE campaign_id = ? ORDER BY name", (auth["campaign_id"],)
                ).fetchall()
            else:
                rows = db.execute(
                    "SELECT * FROM character WHERE id = ?", (auth["character_id"],)
                ).fetchall()
            characters = []
            for row in rows:
                character = dict(row)
                character["stats"] = json.loads(character.pop("stats_json") or "{}")
                character["skills"] = json.loads(character.pop("skills_json") or "[]")
                character.pop("player_token_hash", None)
                character["inventory"] = [dict(item) for item in db.execute(
                    "SELECT * FROM inventory_item WHERE character_id = ? ORDER BY position, id",
                    (character["id"],),
                ).fetchall()]
                if auth["role"] != "warden":
                    character.pop("warden_notes", None)
                characters.append(character)
            self._ensure_turn_crew(db, auth["campaign_id"])
            turn_order = [dict(row) for row in db.execute(
                "SELECT id, character_id, name, kind, position FROM turn_entry "
                "WHERE campaign_id = ? ORDER BY position, id", (auth["campaign_id"],)
            ).fetchall()]
            raw_visibility = db.execute(
                "SELECT map_visibility_json FROM campaign WHERE id = ?", (auth["campaign_id"],)
            ).fetchone()[0]
            try:
                map_visibility = json.loads(raw_visibility or "{}")
            except (TypeError, json.JSONDecodeError):
                map_visibility = {}
            rolls = [dict(row) for row in db.execute(
                "SELECT id, discord_user_id, display_name, expression, result, created_at "
                "FROM roll_event WHERE campaign_id = ? ORDER BY id DESC LIMIT 50",
                (auth["campaign_id"],),
            ).fetchall()]
        return {"role": auth["role"], "campaign": campaign, "characters": characters, "rolls": rolls,
                "turn_order": turn_order, "map_visibility": map_visibility}

    @staticmethod
    def _ensure_turn_crew(db: sqlite3.Connection, campaign_id: int) -> None:
        """Keep every current crewmember in the tracker without disturbing its saved order."""
        next_position = db.execute(
            "SELECT COALESCE(MAX(position), 0) FROM turn_entry WHERE campaign_id = ?", (campaign_id,)
        ).fetchone()[0]
        missing = db.execute(
            "SELECT c.id, c.name FROM character c LEFT JOIN turn_entry t ON t.character_id = c.id "
            "WHERE c.campaign_id = ? AND t.id IS NULL ORDER BY c.name", (campaign_id,)
        ).fetchall()
        for row in missing:
            next_position += 1
            db.execute(
                "INSERT INTO turn_entry(campaign_id, character_id, name, kind, position) VALUES (?, ?, ?, 'crew', ?)",
                (campaign_id, row["id"], row["name"], next_position),
            )
        db.execute(
            "UPDATE turn_entry SET name = (SELECT name FROM character WHERE id = turn_entry.character_id) "
            "WHERE campaign_id = ? AND kind = 'crew'", (campaign_id,)
        )

    def add_enemy(self, auth: dict[str, Any], name: str) -> int | None:
        if auth["role"] != "warden":
            return None
        clean_name = str(name).strip()[:100]
        if not clean_name:
            raise ValueError("Enemy name required")
        with self.connect() as db:
            position = db.execute(
                "SELECT COALESCE(MAX(position), 0) + 1 FROM turn_entry WHERE campaign_id = ?",
                (auth["campaign_id"],),
            ).fetchone()[0]
            return db.execute(
                "INSERT INTO turn_entry(campaign_id, name, kind, position) VALUES (?, ?, 'enemy', ?)",
                (auth["campaign_id"], clean_name, position),
            ).lastrowid

    def delete_enemy(self, auth: dict[str, Any], entry_id: int) -> bool:
        if auth["role"] != "warden":
            return False
        with self.connect() as db:
            changed = db.execute(
                "DELETE FROM turn_entry WHERE id = ? AND campaign_id = ? AND kind = 'enemy'",
                (entry_id, auth["campaign_id"]),
            ).rowcount
        return bool(changed)

    def reorder_turns(self, auth: dict[str, Any], entry_ids: list[int]) -> bool:
        if auth["role"] != "warden" or len(entry_ids) != len(set(entry_ids)):
            return False
        with self.connect() as db:
            self._ensure_turn_crew(db, auth["campaign_id"])
            existing = [row[0] for row in db.execute(
                "SELECT id FROM turn_entry WHERE campaign_id = ?", (auth["campaign_id"],)
            )]
            if set(existing) != set(entry_ids):
                return False
            for position, entry_id in enumerate(entry_ids, 1):
                db.execute(
                    "UPDATE turn_entry SET position = ? WHERE id = ? AND campaign_id = ?",
                    (position, entry_id, auth["campaign_id"]),
                )
        return True

    def update_map_visibility(self, auth: dict[str, Any], visibility: dict[str, Any]) -> bool:
        if auth["role"] != "warden" or not isinstance(visibility, dict):
            return False
        allowed = {
            "garage", "rotunda", "medbay", "armory", "quarters", "laboratory", "east_pod",
            "north_vent", "east_vent",
        }
        clean = {key: bool(value) for key, value in visibility.items() if key in allowed}
        with self.connect() as db:
            changed = db.execute(
                "UPDATE campaign SET map_visibility_json = ? WHERE id = ?",
                (json.dumps(clean, sort_keys=True), auth["campaign_id"]),
            ).rowcount
        return bool(changed)

    def update_character(self, auth: dict[str, Any], character_id: int, fields: dict[str, Any]) -> bool:
        if auth["role"] != "warden" and auth["character_id"] != character_id:
            return False
        allowed = {"name", "hp", "max_hp", "wounds", "max_wounds", "stress", "resolve", "class_name", "public_notes", "stats", "skills"}
        if auth["role"] == "warden":
            allowed.add("warden_notes")
        updates, values = [], []
        for key, value in fields.items():
            if key not in allowed:
                continue
            column = {"stats": "stats_json", "skills": "skills_json"}.get(key, key)
            if key == "stats":
                value = json.dumps(value if isinstance(value, dict) else {})
            if key == "skills":
                clean_skills = value if isinstance(value, list) else []
                value = json.dumps([str(skill)[:80] for skill in clean_skills[:50]])
            if key == "hp":
                value = max(0, int(value))
            if key == "max_hp":
                value = max(1, int(value))
            if key == "wounds":
                value = max(0, min(20, int(value)))
            if key == "max_wounds":
                value = max(1, min(20, int(value)))
            if key == "stress":
                value = max(2, min(20, int(value)))
            if key == "resolve":
                value = max(0, min(5, int(value)))
            if key == "class_name":
                value = str(value).lower()
                if value not in {"", "teamster", "android", "scientist", "marine"}:
                    continue
            updates.append(f"{column} = ?")
            values.append(value)
        if not updates:
            return False
        values.extend((character_id, auth["campaign_id"]))
        with self.connect() as db:
            changed = db.execute(
                f"UPDATE character SET {', '.join(updates)} WHERE id = ? AND campaign_id = ?", values
            ).rowcount
            db.execute(
                "UPDATE character SET wounds = MIN(wounds, max_wounds) WHERE id = ? AND campaign_id = ?",
                (character_id, auth["campaign_id"]),
            )
        return bool(changed)

    def roll_character_stat(
        self, auth: dict[str, Any], character_id: int, requested_stat: str,
        skill_id: str = "", roll_mode: str = "normal",
    ) -> dict[str, Any] | None:
        stat_name = ROLLABLE_STATS.get(str(requested_stat).strip().lower())
        if not stat_name:
            raise ValueError("Unknown stat")
        if auth["role"] != "warden" and auth["character_id"] != character_id:
            return None

        with self.connect() as db:
            character = db.execute(
                "SELECT campaign_id, discord_user_id, name, stats_json, skills_json, class_name, stress FROM character "
                "WHERE id = ? AND campaign_id = ?",
                (character_id, auth["campaign_id"]),
            ).fetchone()
            if not character:
                return None
            stats = json.loads(character["stats_json"] or "{}")
            matching_key = next((name for name in stats if name.lower() == stat_name.lower()), stat_name)
            matching_value = stats.get(matching_key, 0)
            try:
                target = max(0, min(99, int(matching_value)))
            except (TypeError, ValueError):
                target = 0

            clean_skill = str(skill_id).strip().lower()
            known_skills = set(json.loads(character["skills_json"] or "[]")) | CLASS_SKILLS.get(character["class_name"], set())
            if clean_skill and clean_skill not in known_skills:
                raise ValueError("Character does not have that skill")
            skill_bonus = SKILL_BONUSES.get(clean_skill, 0) if clean_skill else 0
            target = min(99, target + skill_bonus)
            roll_mode = str(roll_mode).strip().lower()
            if roll_mode not in ROLL_MODES:
                raise ValueError("Unknown roll mode")
            rolls = [secrets.randbelow(100) + 1 for _ in range(2 if roll_mode != "normal" else 1)]
            def check_quality(value: int) -> tuple[int, int]:
                is_success = value <= target
                is_double = value == 100 or (value < 100 and value % 11 == 0)
                tier = 3 if is_success and is_double else 2 if is_success else 0 if is_double else 1
                return tier, -value
            roll = max(rolls, key=check_quality) if roll_mode == "advantage" else (
                min(rolls, key=check_quality) if roll_mode == "disadvantage" else rolls[0]
            )
            success = roll <= target
            doubles = roll == 100 or (roll < 100 and roll % 11 == 0)
            outcome = "CRITICAL SUCCESS" if success and doubles else (
                "CRITICAL FAILURE" if not success and doubles else ("SUCCESS" if success else "FAILURE")
            )
            stress_before = int(character["stress"])
            stress_after = min(20, stress_before + (0 if success else 1))
            stat_loss = 1 if not success and stress_before >= 20 else 0
            if stress_after != stress_before:
                db.execute("UPDATE character SET stress = ? WHERE id = ?", (stress_after, character_id))
            if stat_loss:
                stats[matching_key] = max(0, int(matching_value) - stat_loss)
                db.execute("UPDATE character SET stats_json = ? WHERE id = ?", (json.dumps(stats), character_id))
            panic_roll = secrets.randbelow(20) + 1 if (not success and doubles) else None
            panic_failed = panic_roll is not None and panic_roll <= stress_after
            skill_text = f" + {clean_skill.replace('-', ' ').title()} {skill_bonus:+d}" if clean_skill else ""
            mode_text = "" if roll_mode == "normal" else f" // {roll_mode.upper()} {rolls}"
            expression = f"{stat_name}{skill_text} check [{target:02d}]"
            result_text = f"D100 {roll:02d}{mode_text} / TARGET {target:02d} // {outcome}"
            if not success:
                result_text += f" // STRESS {stress_before}->{stress_after}"
            if stat_loss:
                result_text += f" // MAX STRESS: {stat_name.upper()} -1"
            if panic_roll is not None:
                panic_outcome = "PANIC - CONSULT TABLE" if panic_failed else "PANIC CHECK PASSED"
                result_text += f" // PANIC D20 {panic_roll:02d} VS STRESS {stress_after:02d}: {panic_outcome}"
            created_at = _now()
            event_id = db.execute(
                "INSERT INTO roll_event(campaign_id, discord_user_id, display_name, expression, result, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (
                    auth["campaign_id"],
                    character["discord_user_id"] or f"character-{character_id}",
                    character["name"],
                    expression,
                    result_text,
                    created_at,
                ),
            ).lastrowid
        return {
            "id": event_id,
            "stat": stat_name,
            "target": target,
            "roll": roll,
            "rolls": rolls,
            "roll_mode": roll_mode,
            "skill": clean_skill or None,
            "skill_bonus": skill_bonus,
            "success": success,
            "critical": doubles,
            "outcome": outcome,
            "stress_before": stress_before,
            "stress_after": stress_after,
            "stat_loss": stat_loss,
            "panic_roll": panic_roll,
            "panic_failed": panic_failed,
            "expression": expression,
            "result": result_text,
            "created_at": created_at,
        }

    def roll_weapon_damage(
        self, auth: dict[str, Any], character_id: int, item_id: int
    ) -> dict[str, Any] | None:
        if auth["role"] != "warden" and auth["character_id"] != character_id:
            return None

        with self.connect() as db:
            weapon = db.execute(
                "SELECT i.name, i.damage, c.discord_user_id, c.name AS character_name "
                "FROM inventory_item i JOIN character c ON c.id = i.character_id "
                "WHERE i.id = ? AND i.character_id = ? AND c.campaign_id = ? AND i.kind = 'weapon'",
                (item_id, character_id, auth["campaign_id"]),
            ).fetchone()
            if not weapon:
                return None
            match = re.fullmatch(r"([1-9][0-9]?)d10", weapon["damage"].strip(), re.IGNORECASE)
            if not match:
                raise ValueError("Weapon has no rollable damage")

            dice_count = int(match.group(1))
            dice = [secrets.randbelow(10) + 1 for _ in range(dice_count)]
            total = sum(dice)
            expression = f"{weapon['name']} damage [{dice_count}d10]"
            result_text = f"D10 {dice} // TOTAL {total}"
            created_at = _now()
            event_id = db.execute(
                "INSERT INTO roll_event(campaign_id, discord_user_id, display_name, expression, result, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (
                    auth["campaign_id"],
                    weapon["discord_user_id"] or f"character-{character_id}",
                    weapon["character_name"],
                    expression,
                    result_text,
                    created_at,
                ),
            ).lastrowid
        return {
            "id": event_id,
            "weapon": weapon["name"],
            "expression": f"{dice_count}d10",
            "dice": dice,
            "total": total,
            "result": result_text,
            "created_at": created_at,
        }

    def add_item(self, auth: dict[str, Any], character_id: int, item: dict[str, Any]) -> int | None:
        if auth["role"] != "warden" and auth["character_id"] != character_id:
            return None
        with self.connect() as db:
            owns_character = db.execute(
                "SELECT 1 FROM character WHERE id = ? AND campaign_id = ?",
                (character_id, auth["campaign_id"]),
            ).fetchone()
            if not owns_character:
                return None
            position = db.execute(
                "SELECT COALESCE(MAX(position), 0) + 1 FROM inventory_item WHERE character_id = ?",
                (character_id,),
            ).fetchone()[0]
            values = self._item_values(item)
            columns = list(values) + ["position"]
            return db.execute(
                f"INSERT INTO inventory_item(character_id, {', '.join(columns)}) "
                f"VALUES (?, {', '.join('?' for _ in columns)})",
                (character_id, *(values[column] for column in values), position),
            ).lastrowid

    @staticmethod
    def _optional_int(value: Any) -> int | None:
        if value is None or value == "":
            return None
        return max(0, int(value))

    @classmethod
    def _item_values(cls, item: dict[str, Any], partial: bool = False) -> dict[str, Any]:
        text_limits = {
            "name": 100,
            "kind": 40,
            "details": 1000,
            "damage": 100,
            "range_band": 100,
            "wound": 100,
            "shots": 100,
            "special": 1000,
            "catalog_key": 100,
        }
        integer_fields = {"ammo", "ammo_max", "armor_points", "damage_reduction", "uses", "uses_max", "cost"}
        values: dict[str, Any] = {}
        for key, limit in text_limits.items():
            if key in item or not partial:
                fallback = "New item" if key == "name" else ("equipment" if key == "kind" else "")
                values[key] = str(item.get(key, fallback)).strip()[:limit]
        if "quantity" in item or not partial:
            values["quantity"] = max(0, int(item.get("quantity", 1)))
        if "equipped" in item or not partial:
            values["equipped"] = 1 if item.get("equipped") else 0
        for key in integer_fields:
            if key in item or not partial:
                values[key] = cls._optional_int(item.get(key))
        return values

    def update_item(self, auth: dict[str, Any], item_id: int, fields: dict[str, Any]) -> bool:
        values = self._item_values(fields, partial=True)
        if not values:
            return False
        updates = ", ".join(f"{column} = ?" for column in values)
        with self.connect() as db:
            changed = db.execute(
                f"UPDATE inventory_item SET {updates} WHERE id = ? AND character_id IN "
                "(SELECT id FROM character WHERE campaign_id = ? AND (? = 'warden' OR id = ?))",
                (*values.values(), item_id, auth["campaign_id"], auth["role"], auth["character_id"]),
            ).rowcount
        return bool(changed)

    def reorder_items(self, auth: dict[str, Any], character_id: int, item_ids: list[int]) -> bool:
        if auth["role"] != "warden" and auth["character_id"] != character_id:
            return False
        if len(item_ids) != len(set(item_ids)):
            return False
        with self.connect() as db:
            owns_character = db.execute(
                "SELECT 1 FROM character WHERE id = ? AND campaign_id = ?",
                (character_id, auth["campaign_id"]),
            ).fetchone()
            existing = [row[0] for row in db.execute(
                "SELECT id FROM inventory_item WHERE character_id = ? ORDER BY position, id",
                (character_id,),
            )]
            if not owns_character or set(existing) != set(item_ids):
                return False
            for position, item_id in enumerate(item_ids, start=1):
                db.execute(
                    "UPDATE inventory_item SET position = ? WHERE id = ? AND character_id = ?",
                    (position, item_id, character_id),
                )
        return True

    def delete_item(self, auth: dict[str, Any], item_id: int) -> bool:
        with self.connect() as db:
            item = db.execute(
                "SELECT character_id FROM inventory_item WHERE id = ?", (item_id,)
            ).fetchone()
            if not item:
                return False
            if auth["role"] != "warden" and auth["character_id"] != item["character_id"]:
                return False
            changed = db.execute(
                "DELETE FROM inventory_item WHERE id = ? AND character_id IN "
                "(SELECT id FROM character WHERE campaign_id = ?)",
                (item_id, auth["campaign_id"]),
            ).rowcount
        return bool(changed)

    def record_roll(
        self, guild_id: str, discord_user_id: str, display_name: str, expression: str, result: str
    ) -> bool:
        with self.connect() as db:
            campaign = db.execute(
                "SELECT id FROM campaign WHERE guild_id = ?", (guild_id,)
            ).fetchone()
            if not campaign:
                return False
            db.execute(
                "INSERT INTO roll_event(campaign_id, discord_user_id, display_name, expression, result, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (campaign["id"], discord_user_id, display_name, expression, result, _now()),
            )
        return True
