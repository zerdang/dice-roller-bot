"""Campaign-isolated battlemap persistence and authorization.

The store uses entity revisions rather than whole-scene writes. Clients may move
optimistically, but only the final revisioned mutation is durable.
"""

from __future__ import annotations

import json
import secrets
import sqlite3
import struct
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator


MAP_SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS map_asset (
    id TEXT PRIMARY KEY, campaign_id INTEGER NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
    media_type TEXT NOT NULL, original_name TEXT NOT NULL, width INTEGER NOT NULL,
    height INTEGER NOT NULL, byte_size INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS map_scene (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
    name TEXT NOT NULL, asset_id TEXT REFERENCES map_asset(id),
    width INTEGER NOT NULL DEFAULT 1600, height INTEGER NOT NULL DEFAULT 900,
    grid_visible INTEGER NOT NULL DEFAULT 1, grid_size REAL NOT NULL DEFAULT 70,
    grid_offset_x REAL NOT NULL DEFAULT 0, grid_offset_y REAL NOT NULL DEFAULT 0,
    units_per_square REAL NOT NULL DEFAULT 5, unit_label TEXT NOT NULL DEFAULT 'ft',
    snap_enabled INTEGER NOT NULL DEFAULT 1, is_active INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS map_one_active_scene
    ON map_scene(campaign_id) WHERE is_active = 1;
CREATE TABLE IF NOT EXISTS map_token (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scene_id INTEGER NOT NULL REFERENCES map_scene(id) ON DELETE CASCADE,
    name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'character', x REAL NOT NULL, y REAL NOT NULL,
    size REAL NOT NULL DEFAULT 1, color TEXT NOT NULL DEFAULT '#4fc3a1', portrait_asset_id TEXT,
    character_id INTEGER REFERENCES character(id) ON DELETE SET NULL,
    owners_json TEXT NOT NULL DEFAULT '[]', locked INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0, counters_json TEXT NOT NULL DEFAULT '[]',
    tags_json TEXT NOT NULL DEFAULT '[]', turn_entry_id INTEGER REFERENCES turn_entry(id) ON DELETE SET NULL,
    revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS map_annotation (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scene_id INTEGER NOT NULL REFERENCES map_scene(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', geometry_json TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#ffb74d', opacity REAL NOT NULL DEFAULT .35,
    icon TEXT NOT NULL DEFAULT '', creator_character_id INTEGER REFERENCES character(id) ON DELETE SET NULL,
    locked INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS map_preset (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, name TEXT NOT NULL, payload_json TEXT NOT NULL,
    is_private INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS map_operation (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
    scene_id INTEGER REFERENCES map_scene(id) ON DELETE CASCADE,
    actor_key TEXT NOT NULL, operation_id TEXT NOT NULL,
    entity_type TEXT NOT NULL, entity_id INTEGER, action TEXT NOT NULL,
    before_json TEXT, after_json TEXT, undone INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, UNIQUE(actor_key, operation_id)
);
CREATE TABLE IF NOT EXISTS map_request (
    actor_key TEXT NOT NULL, operation_id TEXT NOT NULL, response_json TEXT,
    created_at TEXT NOT NULL, PRIMARY KEY(actor_key, operation_id)
);
CREATE INDEX IF NOT EXISTS map_scene_campaign ON map_scene(campaign_id, id);
CREATE INDEX IF NOT EXISTS map_token_scene ON map_token(scene_id, id);
CREATE INDEX IF NOT EXISTS map_annotation_scene ON map_annotation(scene_id, id);
"""

SCENE_FIELDS = {"name", "asset_id", "width", "height", "grid_visible", "grid_size",
                "grid_offset_x", "grid_offset_y", "units_per_square", "unit_label", "snap_enabled"}
TOKEN_FIELDS = {"name", "kind", "x", "y", "size", "color", "portrait_asset_id", "character_id",
                "owners", "locked", "hidden", "counters", "tags", "turn_entry_id"}
ANNOTATION_FIELDS = {"kind", "label", "geometry", "color", "opacity", "icon", "locked", "hidden"}
ANNOTATION_KINDS = {"marker", "circle", "cone", "line", "rectangle"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _json(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), sort_keys=True)


class MapError(ValueError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


class BattlemapStore:
    def __init__(self, path: str, asset_root: str | Path | None = None):
        self.path = path
        self.asset_root = Path(asset_root or Path(path).with_name("companion-assets"))
        self.asset_root.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript(MAP_SCHEMA)

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
    def _actor(auth: dict[str, Any]) -> str:
        identity = "warden" if auth["role"] == "warden" else f"player:{auth['character_id']}"
        return f"campaign:{auth['campaign_id']}:{identity}"

    def _request_result(self, db: sqlite3.Connection, auth: dict[str, Any], operation_id: str | None):
        if not operation_id: return None
        row = db.execute("SELECT response_json FROM map_request WHERE actor_key=? AND operation_id=?",
                         (self._actor(auth), operation_id)).fetchone()
        return json.loads(row["response_json"]) if row and row["response_json"] else None

    def _save_request(self, db: sqlite3.Connection, auth: dict[str, Any], operation_id: str | None,
                      response: dict[str, Any]) -> None:
        if operation_id:
            actor = self._actor(auth)
            db.execute("INSERT OR IGNORE INTO map_request(actor_key,operation_id,response_json,created_at) VALUES(?,?,?,?)",
                       (actor, operation_id, _json(response), _now()))
            db.execute("DELETE FROM map_request WHERE actor_key=? AND operation_id NOT IN "
                       "(SELECT operation_id FROM map_request WHERE actor_key=? ORDER BY rowid DESC LIMIT 500)",
                       (actor, actor))

    @staticmethod
    def _require_dnd(auth: dict[str, Any]) -> None:
        if auth.get("game_system") != "dnd":
            raise MapError("Battlemap is available in the D&D workspace", 403)

    def _scene(self, db: sqlite3.Connection, auth: dict[str, Any], scene_id: int,
               write: bool = False) -> sqlite3.Row:
        row = db.execute("SELECT * FROM map_scene WHERE id = ? AND campaign_id = ?",
                         (scene_id, auth["campaign_id"])).fetchone()
        if not row or (auth["role"] != "warden" and not row["is_active"]):
            raise MapError("Scene not found", 404)
        if write and auth["role"] != "warden":
            raise MapError("Only the DM can edit scenes", 403)
        return row

    @staticmethod
    def _scene_doc(row: sqlite3.Row) -> dict[str, Any]:
        data = dict(row)
        for key in ("grid_visible", "snap_enabled", "is_active"):
            data[key] = bool(data[key])
        return data

    @staticmethod
    def _token_doc(row: sqlite3.Row, public: bool = False) -> dict[str, Any]:
        data = dict(row)
        data["owners"] = json.loads(data.pop("owners_json") or "[]")
        counters = json.loads(data.pop("counters_json") or "[]")
        tags = json.loads(data.pop("tags_json") or "[]")
        if public:
            counters = [item for item in counters if not item.get("private")]
            tags = [item for item in tags if not item.get("private")]
        data["counters"], data["tags"] = counters, tags
        data["locked"], data["hidden"] = bool(data["locked"]), bool(data["hidden"])
        return data

    @staticmethod
    def _annotation_doc(row: sqlite3.Row) -> dict[str, Any]:
        data = dict(row)
        data["geometry"] = json.loads(data.pop("geometry_json"))
        data["locked"], data["hidden"] = bool(data["locked"]), bool(data["hidden"])
        return data

    def list_scenes(self, auth: dict[str, Any]) -> list[dict[str, Any]]:
        self._require_dnd(auth)
        with self.connect() as db:
            sql = "SELECT * FROM map_scene WHERE campaign_id = ?"
            params: list[Any] = [auth["campaign_id"]]
            if auth["role"] != "warden":
                sql += " AND is_active = 1"
            rows = db.execute(sql + " ORDER BY id", params).fetchall()
        return [self._scene_doc(row) for row in rows]

    def create_scene(self, auth: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
        self._require_dnd(auth)
        if auth["role"] != "warden":
            raise MapError("Only the DM can create scenes", 403)
        name = str(payload.get("name", "New scene")).strip()[:100]
        if not name:
            raise MapError("Scene name is required")
        now = _now()
        with self.connect() as db:
            operation_id = str(payload.get("operation_id", ""))[:100] or None
            duplicate = self._request_result(db, auth, operation_id)
            if duplicate: return duplicate
            active = not db.execute("SELECT 1 FROM map_scene WHERE campaign_id = ?", (auth["campaign_id"],)).fetchone()
            scene_id = db.execute(
                "INSERT INTO map_scene(campaign_id,name,width,height,is_active,created_at,updated_at) "
                "VALUES(?,?,?,?,?,?,?)",
                (auth["campaign_id"], name, max(100, int(payload.get("width", 1600))),
                 max(100, int(payload.get("height", 900))), int(active), now, now),
            ).lastrowid
            row = db.execute("SELECT * FROM map_scene WHERE id = ?", (scene_id,)).fetchone()
            result = self._scene_doc(row); self._save_request(db, auth, operation_id, result)
        return result

    def duplicate_scene(self, auth: dict[str, Any], scene_id: int, operation_id: str | None = None) -> dict[str, Any]:
        self._require_dnd(auth)
        if auth["role"] != "warden": raise MapError("Only the DM can duplicate scenes", 403)
        with self.connect() as db:
            duplicate = self._request_result(db, auth, operation_id)
            if duplicate: return duplicate
            source = self._scene(db, auth, scene_id, True); now = _now()
            new_id = db.execute(
                "INSERT INTO map_scene(campaign_id,name,asset_id,width,height,grid_visible,grid_size,grid_offset_x,grid_offset_y,units_per_square,unit_label,snap_enabled,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)",
                (source["campaign_id"], f"{source['name']} copy"[:100], source["asset_id"], source["width"], source["height"], source["grid_visible"], source["grid_size"], source["grid_offset_x"], source["grid_offset_y"], source["units_per_square"], source["unit_label"], source["snap_enabled"], now, now)).lastrowid
            db.execute("INSERT INTO map_token(scene_id,name,kind,x,y,size,color,portrait_asset_id,character_id,owners_json,locked,hidden,counters_json,tags_json,turn_entry_id,created_at,updated_at) SELECT ?,name,kind,x,y,size,color,portrait_asset_id,character_id,owners_json,locked,hidden,counters_json,tags_json,turn_entry_id,?,? FROM map_token WHERE scene_id=?", (new_id, now, now, scene_id))
            db.execute("INSERT INTO map_annotation(scene_id,kind,label,geometry_json,color,opacity,icon,creator_character_id,locked,hidden,created_at,updated_at) SELECT ?,kind,label,geometry_json,color,opacity,icon,creator_character_id,locked,hidden,?,? FROM map_annotation WHERE scene_id=?", (new_id, now, now, scene_id))
            row = db.execute("SELECT * FROM map_scene WHERE id=?", (new_id,)).fetchone()
            result = self._scene_doc(row); self._save_request(db, auth, operation_id, result)
        return result

    def delete_scene(self, auth: dict[str, Any], scene_id: int, operation_id: str | None = None) -> None:
        self._require_dnd(auth)
        if auth["role"] != "warden": raise MapError("Only the DM can delete scenes", 403)
        with self.connect() as db:
            if self._request_result(db, auth, operation_id): return
            scene = self._scene(db, auth, scene_id, True)
            db.execute("DELETE FROM map_scene WHERE id=?", (scene_id,))
            if scene["is_active"]:
                replacement = db.execute("SELECT id FROM map_scene WHERE campaign_id=? ORDER BY id LIMIT 1", (auth["campaign_id"],)).fetchone()
                if replacement: db.execute("UPDATE map_scene SET is_active=1,revision=revision+1,updated_at=? WHERE id=?", (_now(), replacement["id"]))
            self._save_request(db, auth, operation_id, {"ok": True})

    def update_scene(self, auth: dict[str, Any], scene_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        self._require_dnd(auth)
        with self.connect() as db:
            operation_id = str(payload.get("operation_id", ""))[:100] or None
            duplicate = self._request_result(db, auth, operation_id)
            if duplicate: return duplicate
            row = self._scene(db, auth, scene_id, True)
            expected = int(payload.get("revision", row["revision"]))
            if expected != row["revision"]:
                raise MapError("Scene changed; refresh and retry", 409)
            if payload.get("activate"):
                db.execute("UPDATE map_scene SET is_active=0 WHERE campaign_id=?", (auth["campaign_id"],))
                db.execute("UPDATE map_scene SET is_active=1,revision=revision+1,updated_at=? WHERE id=?",
                           (_now(), scene_id))
            else:
                clean = self._clean_scene(payload)
                if clean.get("asset_id") and not db.execute(
                    "SELECT 1 FROM map_asset WHERE id=? AND campaign_id=?",
                    (clean["asset_id"], auth["campaign_id"]),
                ).fetchone():
                    raise MapError("Map asset not found", 404)
                if clean:
                    sets = ",".join(f"{key}=?" for key in clean)
                    db.execute(f"UPDATE map_scene SET {sets},revision=revision+1,updated_at=? WHERE id=? AND revision=?",
                               (*clean.values(), _now(), scene_id, expected))
            updated = db.execute("SELECT * FROM map_scene WHERE id=?", (scene_id,)).fetchone()
            result = self._scene_doc(updated); self._save_request(db, auth, operation_id, result)
        return result

    @staticmethod
    def _image_info(data: bytes) -> tuple[str, int, int]:
        if data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24:
            width, height = struct.unpack(">II", data[16:24])
            return "image/png", width, height
        if data.startswith(b"\xff\xd8"):
            offset = 2
            while offset + 9 < len(data):
                if data[offset] != 0xFF:
                    offset += 1; continue
                marker = data[offset + 1]
                if marker in {0xD8, 0xD9}:
                    offset += 2; continue
                length = int.from_bytes(data[offset + 2:offset + 4], "big")
                if marker in range(0xC0, 0xC4) or marker in range(0xC5, 0xC8) or marker in range(0xC9, 0xCC) or marker in range(0xCD, 0xD0):
                    height = int.from_bytes(data[offset + 5:offset + 7], "big")
                    width = int.from_bytes(data[offset + 7:offset + 9], "big")
                    return "image/jpeg", width, height
                if length < 2: break
                offset += 2 + length
        if data.startswith(b"RIFF") and data[8:12] == b"WEBP" and len(data) >= 30:
            kind, body = data[12:16], data[20:]
            if kind == b"VP8X" and len(body) >= 10:
                return "image/webp", 1 + int.from_bytes(body[4:7], "little"), 1 + int.from_bytes(body[7:10], "little")
            if kind == b"VP8L" and len(body) >= 5 and body[0] == 0x2F:
                width = 1 + body[1] + ((body[2] & 0x3F) << 8)
                height = 1 + ((body[2] >> 6) | (body[3] << 2) | ((body[4] & 0x0F) << 10))
                return "image/webp", width, height
            if kind == b"VP8 " and len(body) >= 10 and body[3:6] == b"\x9d\x01\x2a":
                return "image/webp", int.from_bytes(body[6:8], "little") & 0x3FFF, int.from_bytes(body[8:10], "little") & 0x3FFF
        raise MapError("Upload must be a valid PNG, JPEG, or WebP image")

    def store_asset(self, auth: dict[str, Any], name: str, data: bytes,
                    operation_id: str | None = None) -> dict[str, Any]:
        self._require_dnd(auth)
        if auth["role"] != "warden": raise MapError("Only the DM can upload maps", 403)
        if not data or len(data) > 20 * 1024 * 1024: raise MapError("Map image must be 20 MiB or smaller")
        media_type, width, height = self._image_info(data)
        if width < 1 or height < 1 or width > 12000 or height > 12000 or width * height > 80_000_000:
            raise MapError("Map dimensions exceed the 12,000 px / 80 megapixel limit")
        operation_id = str(operation_id or "")[:100] or None
        with self.connect() as db:
            duplicate = self._request_result(db, auth, operation_id)
            if duplicate: return duplicate
            asset_id = secrets.token_urlsafe(18)
            extension = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}[media_type]
            folder = self.asset_root / str(auth["campaign_id"])
            folder.mkdir(parents=True, exist_ok=True)
            path = folder / f"{asset_id}{extension}"
            path.write_bytes(data)
            try:
                db.execute("INSERT INTO map_asset(id,campaign_id,media_type,original_name,width,height,byte_size,created_at) VALUES(?,?,?,?,?,?,?,?)",
                           (asset_id, auth["campaign_id"], media_type, str(name)[:200], width, height, len(data), _now()))
                result = {"id": asset_id, "media_type": media_type, "original_name": str(name)[:200], "width": width, "height": height, "byte_size": len(data)}
                self._save_request(db, auth, operation_id, result)
            except Exception:
                path.unlink(missing_ok=True)
                raise
        return result

    def asset(self, auth: dict[str, Any], asset_id: str) -> tuple[Path, str]:
        self._require_dnd(auth)
        with self.connect() as db:
            row = db.execute("SELECT * FROM map_asset WHERE id=? AND campaign_id=?", (asset_id, auth["campaign_id"])).fetchone()
            if not row: raise MapError("Asset not found", 404)
            if auth["role"] != "warden" and not db.execute(
                "SELECT 1 FROM map_scene s LEFT JOIN map_token t ON t.scene_id=s.id "
                "WHERE s.campaign_id=? AND s.is_active=1 AND "
                "(s.asset_id=? OR (t.portrait_asset_id=? AND t.hidden=0))",
                (auth["campaign_id"], asset_id, asset_id),
            ).fetchone(): raise MapError("Asset not found", 404)
        extension = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}[row["media_type"]]
        path = self.asset_root / str(auth["campaign_id"]) / f"{asset_id}{extension}"
        if not path.is_file(): raise MapError("Asset file is missing", 404)
        return path, row["media_type"]

    @staticmethod
    def _clean_scene(payload: dict[str, Any]) -> dict[str, Any]:
        clean = {key: payload[key] for key in SCENE_FIELDS if key in payload}
        if "name" in clean:
            clean["name"] = str(clean["name"]).strip()[:100]
        for key in ("width", "height"):
            if key in clean: clean[key] = max(100, min(12000, int(clean[key])))
        for key in ("grid_size", "units_per_square"):
            if key in clean: clean[key] = max(.01, float(clean[key]))
        for key in ("grid_offset_x", "grid_offset_y"):
            if key in clean: clean[key] = float(clean[key])
        for key in ("grid_visible", "snap_enabled"):
            if key in clean: clean[key] = int(bool(clean[key]))
        if "unit_label" in clean: clean["unit_label"] = str(clean["unit_label"])[:16]
        return clean

    def snapshot(self, auth: dict[str, Any], scene_id: int | None = None) -> dict[str, Any]:
        self._require_dnd(auth)
        with self.connect() as db:
            if scene_id is None:
                row = db.execute("SELECT id FROM map_scene WHERE campaign_id=? AND is_active=1",
                                 (auth["campaign_id"],)).fetchone()
                if not row:
                    return {"scene": None, "tokens": [], "annotations": [], "presets": []}
                scene_id = row["id"]
            scene = self._scene(db, auth, scene_id)
            token_sql = "SELECT * FROM map_token WHERE scene_id=?"
            annotation_sql = "SELECT * FROM map_annotation WHERE scene_id=?"
            if auth["role"] != "warden":
                token_sql += " AND hidden=0"
                annotation_sql += " AND hidden=0"
            tokens = [self._token_doc(row, auth["role"] != "warden") for row in
                      db.execute(token_sql + " ORDER BY id", (scene_id,)).fetchall()]
            # Character-linked tokens read the canonical character/D&D resource rows;
            # values are never copied into token counters. Exact HP is DM/owner only.
            has_dnd_resources = bool(db.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='dnd_character'"
            ).fetchone())
            for token in tokens:
                character_id = token.get("character_id")
                may_see_exact = auth["role"] == "warden" or auth.get("character_id") == character_id
                if character_id and may_see_exact:
                    health = db.execute(
                        ("SELECT c.hp,c.max_hp,COALESCE(d.temp_hp,0) AS temp_hp FROM character c "
                         "LEFT JOIN dnd_character d ON d.character_id=c.id WHERE c.id=? AND c.campaign_id=?")
                        if has_dnd_resources else
                        "SELECT hp,max_hp,0 AS temp_hp FROM character WHERE id=? AND campaign_id=?",
                        (character_id, auth["campaign_id"]),
                    ).fetchone()
                    if health:
                        token["health"] = dict(health)
            annotations = [self._annotation_doc(row) for row in
                           db.execute(annotation_sql + " ORDER BY id", (scene_id,)).fetchall()]
            preset_sql = "SELECT * FROM map_preset WHERE campaign_id=?"
            if auth["role"] != "warden": preset_sql += " AND is_private=0"
            presets = []
            for row in db.execute(preset_sql + " ORDER BY name", (auth["campaign_id"],)).fetchall():
                item = dict(row); item["payload"] = json.loads(item.pop("payload_json")); item["is_private"] = bool(item["is_private"]); presets.append(item)
        return {"scene": self._scene_doc(scene), "tokens": tokens, "annotations": annotations, "presets": presets}

    def _can_token(self, auth: dict[str, Any], row: sqlite3.Row) -> bool:
        return auth["role"] == "warden" or (not row["locked"] and auth["character_id"] in json.loads(row["owners_json"] or "[]"))

    @staticmethod
    def _validate_token_refs(db: sqlite3.Connection, auth: dict[str, Any], clean: dict[str, Any]) -> None:
        campaign_id = auth["campaign_id"]
        owners = clean.get("owners")
        if owners is not None:
            found = {row[0] for row in db.execute(
                f"SELECT id FROM character WHERE campaign_id=? AND id IN ({','.join('?' for _ in owners) or 'NULL'})",
                (campaign_id, *owners),
            )}
            if found != set(owners): raise MapError("Token owner is outside this campaign", 400)
        checks = (
            ("character_id", "character", "id"),
            ("turn_entry_id", "turn_entry", "id"),
            ("portrait_asset_id", "map_asset", "id"),
        )
        for key, table, column in checks:
            value = clean.get(key)
            if value is not None and not db.execute(
                f"SELECT 1 FROM {table} WHERE {column}=? AND campaign_id=?", (value, campaign_id)
            ).fetchone(): raise MapError(f"{key} is outside this campaign", 400)

    def _record(self, db: sqlite3.Connection, auth: dict[str, Any], scene_id: int,
                entity_type: str, entity_id: int, action: str,
                before: dict[str, Any] | None, after: dict[str, Any] | None,
                operation_id: str | None = None) -> None:
        actor = self._actor(auth)
        db.execute("INSERT INTO map_operation(campaign_id,scene_id,actor_key,operation_id,entity_type,entity_id,action,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                   (auth["campaign_id"], scene_id, actor, operation_id or secrets.token_urlsafe(12), entity_type, entity_id,
                    action, _json(before) if before else None, _json(after) if after else None, _now()))
        db.execute("DELETE FROM map_operation WHERE actor_key=? AND campaign_id=? AND id NOT IN "
                   "(SELECT id FROM map_operation WHERE actor_key=? AND campaign_id=? ORDER BY id DESC LIMIT 20)",
                   (actor, auth["campaign_id"], actor, auth["campaign_id"]))

    def create_token(self, auth: dict[str, Any], scene_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        self._require_dnd(auth)
        if auth["role"] != "warden": raise MapError("Only the DM can create tokens", 403)
        now = _now(); clean = self._clean_token(payload, True)
        with self.connect() as db:
            operation_id = str(payload.get("operation_id", ""))[:100] or None
            if operation_id:
                duplicate = db.execute("SELECT after_json FROM map_operation WHERE actor_key=? AND operation_id=?",
                                       (self._actor(auth), operation_id)).fetchone()
                if duplicate: return json.loads(duplicate["after_json"])
            self._scene(db, auth, scene_id)
            self._validate_token_refs(db, auth, clean)
            token_id = db.execute(
                "INSERT INTO map_token(scene_id,name,kind,x,y,size,color,character_id,owners_json,locked,hidden,counters_json,tags_json,turn_entry_id,created_at,updated_at) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (scene_id, clean["name"], clean["kind"], clean["x"], clean["y"], clean["size"], clean["color"],
                 clean.get("character_id"), _json(clean["owners"]), int(clean["locked"]), int(clean["hidden"]),
                 _json(clean["counters"]), _json(clean["tags"]), clean.get("turn_entry_id"), now, now)).lastrowid
            row = db.execute("SELECT * FROM map_token WHERE id=?", (token_id,)).fetchone()
            self._record(db, auth, scene_id, "token", token_id, "create", None, self._token_doc(row), operation_id)
        return self._token_doc(row)

    @staticmethod
    def _clean_token(payload: dict[str, Any], creating: bool = False) -> dict[str, Any]:
        clean = {key: payload[key] for key in TOKEN_FIELDS if key in payload}
        if creating:
            clean = {"name": "Token", "kind": "character", "x": 100, "y": 100, "size": 1,
                     "color": "#4fc3a1", "owners": [], "locked": False, "hidden": False,
                     "counters": [], "tags": [], **clean}
        if "name" in clean: clean["name"] = str(clean["name"]).strip()[:100] or "Token"
        if "kind" in clean: clean["kind"] = str(clean["kind"])[:20]
        for key in ("x", "y"):
            if key in clean: clean[key] = float(clean[key])
        if "size" in clean: clean["size"] = max(.25, min(10, float(clean["size"])))
        if "color" in clean: clean["color"] = str(clean["color"])[:20]
        if "owners" in clean: clean["owners"] = sorted({int(v) for v in clean["owners"]})
        for key in ("locked", "hidden"):
            if key in clean: clean[key] = bool(clean[key])
        for key in ("counters", "tags"):
            if key in clean and not isinstance(clean[key], list): raise MapError(f"{key} must be a list")
        return clean

    def update_token(self, auth: dict[str, Any], token_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        self._require_dnd(auth)
        with self.connect() as db:
            operation_id = str(payload.get("operation_id", ""))[:100] or None
            if operation_id:
                duplicate = db.execute("SELECT after_json FROM map_operation WHERE actor_key=? AND operation_id=?",
                                       (self._actor(auth), operation_id)).fetchone()
                if duplicate: return json.loads(duplicate["after_json"])
            row = db.execute("SELECT t.* FROM map_token t JOIN map_scene s ON s.id=t.scene_id WHERE t.id=? AND s.campaign_id=?",
                             (token_id, auth["campaign_id"])).fetchone()
            if not row: raise MapError("Token not found", 404)
            self._scene(db, auth, row["scene_id"])
            if not self._can_token(auth, row): raise MapError("Token cannot be edited", 403)
            expected = int(payload.get("revision", -1))
            if expected != row["revision"]: raise MapError("Token changed; refresh and retry", 409)
            clean = self._clean_token(payload)
            before = self._token_doc(row)
            if auth["role"] != "warden":
                for key in ("owners", "locked", "hidden", "character_id", "turn_entry_id", "portrait_asset_id"):
                    clean.pop(key, None)
            self._validate_token_refs(db, auth, clean)
            columns = {"owners": "owners_json", "counters": "counters_json", "tags": "tags_json"}
            encoded = {columns.get(k, k): (_json(v) if k in columns else int(v) if k in {"locked", "hidden"} else v)
                       for k, v in clean.items()}
            if encoded:
                sets = ",".join(f"{key}=?" for key in encoded)
                changed = db.execute(f"UPDATE map_token SET {sets},revision=revision+1,updated_at=? WHERE id=? AND revision=?",
                                     (*encoded.values(), _now(), token_id, expected)).rowcount
                if not changed: raise MapError("Token changed; refresh and retry", 409)
            updated = db.execute("SELECT * FROM map_token WHERE id=?", (token_id,)).fetchone()
            if encoded: self._record(db, auth, row["scene_id"], "token", token_id, "update", before, self._token_doc(updated), operation_id)
        return self._token_doc(updated, auth["role"] != "warden")

    def counter_delta(self, auth: dict[str, Any], token_id: int, key: str, delta: int,
                      revision: int, operation_id: str | None = None) -> dict[str, Any]:
        self._require_dnd(auth)
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            if operation_id:
                duplicate = db.execute("SELECT after_json FROM map_operation WHERE actor_key=? AND operation_id=?",
                                       (self._actor(auth), operation_id)).fetchone()
                if duplicate: return json.loads(duplicate["after_json"])
            row = db.execute("SELECT t.* FROM map_token t JOIN map_scene s ON s.id=t.scene_id WHERE t.id=? AND s.campaign_id=?",
                             (token_id, auth["campaign_id"])).fetchone()
            if not row: raise MapError("Token not found", 404)
            if not self._can_token(auth, row): raise MapError("Token cannot be edited", 403)
            counters = json.loads(row["counters_json"] or "[]")
            before = self._token_doc(row)
            counter = next((item for item in counters if str(item.get("key")) == key), None)
            if not counter or (counter.get("private") and auth["role"] != "warden"):
                raise MapError("Counter not found", 404)
            value = int(counter.get("value", 0)) + max(-100000, min(100000, int(delta)))
            if counter.get("min") is not None: value = max(int(counter["min"]), value)
            if counter.get("max") is not None: value = min(int(counter["max"]), value)
            counter["value"] = value
            db.execute("UPDATE map_token SET counters_json=?,revision=revision+1,updated_at=? WHERE id=?",
                       (_json(counters), _now(), token_id))
            updated = db.execute("SELECT * FROM map_token WHERE id=?", (token_id,)).fetchone()
            self._record(db, auth, row["scene_id"], "token", token_id, "update", before, self._token_doc(updated), operation_id)
        return self._token_doc(updated, auth["role"] != "warden")

    def create_annotation(self, auth: dict[str, Any], scene_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        self._require_dnd(auth); clean = self._clean_annotation(payload, True); now = _now()
        with self.connect() as db:
            operation_id = str(payload.get("operation_id", ""))[:100] or None
            if operation_id:
                duplicate = db.execute("SELECT after_json FROM map_operation WHERE actor_key=? AND operation_id=?",
                                       (self._actor(auth), operation_id)).fetchone()
                if duplicate: return json.loads(duplicate["after_json"])
            self._scene(db, auth, scene_id)
            creator = None if auth["role"] == "warden" else auth["character_id"]
            item_id = db.execute(
                "INSERT INTO map_annotation(scene_id,kind,label,geometry_json,color,opacity,icon,creator_character_id,locked,hidden,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                (scene_id, clean["kind"], clean["label"], _json(clean["geometry"]), clean["color"], clean["opacity"],
                 clean["icon"], creator, int(clean["locked"]), int(clean["hidden"]), now, now)).lastrowid
            row = db.execute("SELECT * FROM map_annotation WHERE id=?", (item_id,)).fetchone()
            self._record(db, auth, scene_id, "annotation", item_id, "create", None, self._annotation_doc(row), operation_id)
        return self._annotation_doc(row)

    def update_annotation(self, auth: dict[str, Any], item_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        self._require_dnd(auth)
        with self.connect() as db:
            operation_id = str(payload.get("operation_id", ""))[:100] or None
            if operation_id:
                duplicate = db.execute("SELECT after_json FROM map_operation WHERE actor_key=? AND operation_id=?",
                                       (self._actor(auth), operation_id)).fetchone()
                if duplicate: return json.loads(duplicate["after_json"])
            row = db.execute("SELECT a.* FROM map_annotation a JOIN map_scene s ON s.id=a.scene_id WHERE a.id=? AND s.campaign_id=?",
                             (item_id, auth["campaign_id"])).fetchone()
            if not row: raise MapError("Annotation not found", 404)
            self._scene(db, auth, row["scene_id"])
            if auth["role"] != "warden" and (row["locked"] or row["creator_character_id"] != auth["character_id"]):
                raise MapError("Annotation cannot be edited", 403)
            expected = int(payload.get("revision", -1))
            if expected != row["revision"]: raise MapError("Annotation changed; refresh and retry", 409)
            clean = self._clean_annotation({**self._annotation_doc(row), **payload})
            if auth["role"] != "warden":
                clean.pop("locked", None); clean.pop("hidden", None)
            before = self._annotation_doc(row)
            columns = {"geometry": "geometry_json"}
            encoded = {columns.get(k, k): _json(v) if k == "geometry" else int(v) if k in {"locked", "hidden"} else v for k, v in clean.items()}
            sets = ",".join(f"{key}=?" for key in encoded)
            db.execute(f"UPDATE map_annotation SET {sets},revision=revision+1,updated_at=? WHERE id=? AND revision=?",
                       (*encoded.values(), _now(), item_id, expected))
            updated = db.execute("SELECT * FROM map_annotation WHERE id=?", (item_id,)).fetchone()
            self._record(db, auth, row["scene_id"], "annotation", item_id, "update", before, self._annotation_doc(updated), operation_id)
        return self._annotation_doc(updated)

    def delete_entity(self, auth: dict[str, Any], entity_type: str, entity_id: int,
                      operation_id: str | None = None) -> None:
        self._require_dnd(auth)
        if entity_type not in {"token", "annotation"}: raise MapError("Invalid entity")
        table = "map_token" if entity_type == "token" else "map_annotation"
        with self.connect() as db:
            if operation_id and db.execute("SELECT 1 FROM map_operation WHERE actor_key=? AND operation_id=?",
                                           (self._actor(auth), operation_id)).fetchone(): return
            row = db.execute(f"SELECT e.* FROM {table} e JOIN map_scene s ON s.id=e.scene_id WHERE e.id=? AND s.campaign_id=?",
                             (entity_id, auth["campaign_id"])).fetchone()
            if not row: raise MapError("Map object not found", 404)
            if entity_type == "token" and auth["role"] != "warden": raise MapError("Only the DM can remove tokens", 403)
            if entity_type == "annotation" and auth["role"] != "warden" and (row["locked"] or row["creator_character_id"] != auth["character_id"]):
                raise MapError("Annotation cannot be removed", 403)
            before = self._token_doc(row) if entity_type == "token" else self._annotation_doc(row)
            db.execute(f"DELETE FROM {table} WHERE id=?", (entity_id,))
            self._record(db, auth, row["scene_id"], entity_type, entity_id, "delete", before, None, operation_id)

    def undo(self, auth: dict[str, Any]) -> dict[str, Any]:
        self._require_dnd(auth); actor = self._actor(auth)
        with self.connect() as db:
            op = db.execute("SELECT * FROM map_operation WHERE campaign_id=? AND actor_key=? AND undone=0 ORDER BY id DESC LIMIT 1",
                            (auth["campaign_id"], actor)).fetchone()
            if not op: raise MapError("Nothing to undo", 404)
            table = {"token": "map_token", "annotation": "map_annotation"}.get(op["entity_type"])
            if not table: raise MapError("Operation cannot be undone", 409)
            before = json.loads(op["before_json"]) if op["before_json"] else None
            after = json.loads(op["after_json"]) if op["after_json"] else None
            current = db.execute(f"SELECT * FROM {table} WHERE id=?", (op["entity_id"],)).fetchone()
            if op["action"] == "create":
                if not current or current["revision"] != after["revision"]: raise MapError("Object changed; undo refused", 409)
                db.execute(f"DELETE FROM {table} WHERE id=?", (op["entity_id"],))
                result = {"deleted": op["entity_id"]}
            elif op["action"] == "delete":
                if current: raise MapError("Object identifier was reused; undo refused", 409)
                data = before.copy(); data.pop("owners", None); data.pop("counters", None); data.pop("tags", None); data.pop("geometry", None)
                if table == "map_token":
                    columns = ["id","scene_id","name","kind","x","y","size","color","portrait_asset_id","character_id","owners_json","locked","hidden","counters_json","tags_json","turn_entry_id","revision","created_at","updated_at"]
                    values = [before.get(k) for k in columns]; values[columns.index("owners_json")] = _json(before["owners"]); values[columns.index("counters_json")] = _json(before["counters"]); values[columns.index("tags_json")] = _json(before["tags"])
                else:
                    columns = ["id","scene_id","kind","label","geometry_json","color","opacity","icon","creator_character_id","locked","hidden","revision","created_at","updated_at"]
                    values = [before.get(k) for k in columns]; values[columns.index("geometry_json")] = _json(before["geometry"])
                db.execute(f"INSERT INTO {table}({','.join(columns)}) VALUES({','.join('?' for _ in columns)})", values)
                result = before
            else:
                if not current or current["revision"] != after["revision"]: raise MapError("Object changed; undo refused", 409)
                if table == "map_token":
                    db.execute("UPDATE map_token SET name=?,kind=?,x=?,y=?,size=?,color=?,portrait_asset_id=?,character_id=?,owners_json=?,locked=?,hidden=?,counters_json=?,tags_json=?,turn_entry_id=?,revision=revision+1,updated_at=? WHERE id=?",
                               (before["name"],before["kind"],before["x"],before["y"],before["size"],before["color"],before.get("portrait_asset_id"),before.get("character_id"),_json(before["owners"]),int(before["locked"]),int(before["hidden"]),_json(before["counters"]),_json(before["tags"]),before.get("turn_entry_id"),_now(),op["entity_id"]))
                    result = self._token_doc(db.execute("SELECT * FROM map_token WHERE id=?", (op["entity_id"],)).fetchone(), auth["role"] != "warden")
                else:
                    db.execute("UPDATE map_annotation SET kind=?,label=?,geometry_json=?,color=?,opacity=?,icon=?,locked=?,hidden=?,revision=revision+1,updated_at=? WHERE id=?",
                               (before["kind"],before["label"],_json(before["geometry"]),before["color"],before["opacity"],before["icon"],int(before["locked"]),int(before["hidden"]),_now(),op["entity_id"]))
                    result = self._annotation_doc(db.execute("SELECT * FROM map_annotation WHERE id=?", (op["entity_id"],)).fetchone())
            db.execute("UPDATE map_operation SET undone=1 WHERE id=?", (op["id"],))
        return {"ok": True, "entity_type": op["entity_type"], "result": result}

    @staticmethod
    def _clean_annotation(payload: dict[str, Any], creating: bool = False) -> dict[str, Any]:
        clean = {key: payload[key] for key in ANNOTATION_FIELDS if key in payload}
        if creating:
            clean = {"kind": "marker", "label": "Marker", "geometry": {"x": 100, "y": 100},
                     "color": "#ffb74d", "opacity": .35, "icon": "", "locked": False, "hidden": False, **clean}
        if clean.get("kind") not in ANNOTATION_KINDS: raise MapError("Invalid annotation kind")
        if "geometry" in clean:
            if not isinstance(clean["geometry"], dict): raise MapError("Geometry must be an object")
            clean["geometry"] = {str(k)[:30]: float(v) for k, v in clean["geometry"].items() if isinstance(v, (int, float))}
        if "label" in clean: clean["label"] = str(clean["label"])[:100]
        if "color" in clean: clean["color"] = str(clean["color"])[:20]
        if "icon" in clean: clean["icon"] = str(clean["icon"])[:30]
        if "opacity" in clean: clean["opacity"] = max(.05, min(1, float(clean["opacity"])))
        for key in ("locked", "hidden"):
            if key in clean: clean[key] = bool(clean[key])
        return clean

    def upsert_preset(self, auth: dict[str, Any], payload: dict[str, Any], preset_id: int | None = None) -> dict[str, Any]:
        self._require_dnd(auth)
        if auth["role"] != "warden": raise MapError("Only the DM can manage presets", 403)
        kind = str(payload.get("kind", "tag"))
        if kind not in {"tag", "counter"}: raise MapError("Invalid preset kind")
        name = str(payload.get("name", "")).strip()[:80]
        value = payload.get("payload", {})
        if not name or not isinstance(value, dict): raise MapError("Preset name and payload are required")
        with self.connect() as db:
            operation_id = str(payload.get("operation_id", ""))[:100] or None
            duplicate = self._request_result(db, auth, operation_id)
            if duplicate: return duplicate
            if preset_id:
                changed = db.execute("UPDATE map_preset SET kind=?,name=?,payload_json=?,is_private=?,revision=revision+1 WHERE id=? AND campaign_id=?",
                                     (kind, name, _json(value), int(bool(payload.get("is_private"))), preset_id, auth["campaign_id"])).rowcount
                if not changed: raise MapError("Preset not found", 404)
            else:
                preset_id = db.execute("INSERT INTO map_preset(campaign_id,kind,name,payload_json,is_private) VALUES(?,?,?,?,?)",
                                       (auth["campaign_id"], kind, name, _json(value), int(bool(payload.get("is_private"))))).lastrowid
            row = db.execute("SELECT * FROM map_preset WHERE id=?", (preset_id,)).fetchone()
            data = dict(row); data["payload"] = json.loads(data.pop("payload_json")); data["is_private"] = bool(data["is_private"])
            self._save_request(db, auth, operation_id, data)
        return data

    def delete_preset(self, auth: dict[str, Any], preset_id: int, operation_id: str | None = None) -> None:
        self._require_dnd(auth)
        if auth["role"] != "warden": raise MapError("Only the DM can manage presets", 403)
        with self.connect() as db:
            if self._request_result(db, auth, operation_id): return
            if not db.execute("DELETE FROM map_preset WHERE id=? AND campaign_id=?",
                              (preset_id, auth["campaign_id"])).rowcount:
                raise MapError("Preset not found", 404)
            self._save_request(db, auth, operation_id, {"ok": True})
