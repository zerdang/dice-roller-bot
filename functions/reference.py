"""Private, versioned 5etools reference catalog. Does not execute imported content."""
from __future__ import annotations

import copy
import hashlib
import json
import re
import sqlite3
from collections import Counter
from contextlib import contextmanager
from datetime import datetime, timezone

from functions.dnd import DndError

TYPES = {
    "class": "Class", "subclass": "Subclass", "classFeature": "Class feature",
    "subclassFeature": "Subclass feature", "race": "Species", "subrace": "Lineage",
    "background": "Background", "feat": "Feat", "optionalfeature": "Optional feature",
    "charoption": "Character option", "spell": "Spell", "item": "Item",
    "baseitem": "Equipment", "condition": "Condition", "action": "Action",
    "skill": "Skill", "language": "Language", "sense": "Sense",
}
PARENTS = ("className", "classSource", "subclassShortName", "subclassSource", "raceName", "raceSource", "level")
FIELD_LABELS = {
    "ability": "Ability adjustments", "speed": "Speed", "size": "Size", "hd": "Hit Dice",
    "proficiency": "Saving throw proficiencies", "skillProficiencies": "Skill proficiencies",
    "toolProficiencies": "Tool proficiencies", "languageProficiencies": "Languages", "feats": "Feats",
    "startingProficiencies": "Starting proficiencies", "startingEquipment": "Starting equipment",
    "classFeatures": "Class features", "subclassFeatures": "Subclass features",
}


def mechanical_text(value):
    labels = {"str": "Strength", "dex": "Dexterity", "con": "Constitution", "int": "Intelligence",
              "wis": "Wisdom", "cha": "Charisma", "s": "Small", "m": "Medium",
              "classFeature": "Feature", "subclassFeature": "Feature", "isClassFeatureVariant": "Variant"}
    if isinstance(value, dict):
        return "; ".join((labels.get(key, re.sub(r"([a-z])([A-Z])", r"\1 \2", key).capitalize()) +
                          ("" if item is True else ": " + mechanical_text(item)))
                         for key, item in value.items() if not key.startswith("_") and item is not False)
    if isinstance(value, list):
        return "\n".join("• " + mechanical_text(item) for item in value)
    if isinstance(value, str):
        parts = value.split("|")
        return labels.get(value.lower(), plain(parts[0])) + (f" ({parts[1]})" if len(parts) > 1 and parts[1] else "")
    return str(value)


SPELL_SCHOOLS = {"A": "Abjuration", "C": "Conjuration", "D": "Divination", "E": "Enchantment",
                 "V": "Evocation", "I": "Illusion", "N": "Necromancy", "T": "Transmutation"}


def entry_metadata(kind, raw):
    """Small, readable facts for catalog rows and the builder detail pane."""
    if kind == "spell":
        level = raw.get("level")
        times = raw.get("time") or []
        casting = ", ".join(f"{part.get('number', 1)} {str(part.get('unit', '')).replace('_', ' ')}".strip()
                             for part in times if isinstance(part, dict))
        distance = (raw.get("range") or {}).get("distance") or {}
        range_type = (raw.get("range") or {}).get("type", "")
        if isinstance(distance, dict) and distance.get("amount") is not None:
            reach = f"{distance['amount']} {distance.get('type', '')}".strip()
            reach = f"Self ({reach})" if range_type == "self" else reach
        else:
            reach = str(distance.get("type") or range_type).replace("_", " ").title() if isinstance(distance, dict) else ""
        parts = raw.get("components") or {}
        components = [letter.upper() for letter in ("v", "s") if parts.get(letter)] if isinstance(parts, dict) else []
        material = parts.get("m") if isinstance(parts, dict) else None
        if material:
            components.append("M" + (f" ({plain(material.get('text', material))})" if isinstance(material, dict)
                                     else f" ({plain(material)})" if isinstance(material, str) else ""))
        durations = raw.get("duration") or []
        duration_parts = []
        for item in durations:
            if not isinstance(item, dict):
                continue
            unit = item.get("duration") or {}
            label = f"{unit.get('amount', '')} {unit.get('type', '')}".strip() if isinstance(unit, dict) and unit else str(item.get("type", ""))
            duration_parts.append(("Concentration, up to " if item.get("concentration") else "") + label)
        classes = (raw.get("classes") or {}).get("fromClassList") or []
        return {"level": level if type(level) is int else None,
                "school": SPELL_SCHOOLS.get(raw.get("school"), raw.get("school", "")),
                "casting_time": casting, "range": reach, "components": ", ".join(components),
                "duration": ", ".join(duration_parts), "ritual": bool((raw.get("meta") or {}).get("ritual")),
                "classes": ", ".join(item.get("name", "") for item in classes if isinstance(item, dict))}
    fields = {
        "class": ("hd", "primaryAbility", "proficiency", "spellcastingAbility"),
        "race": ("size", "speed", "creatureTypes", "ability"),
        "subrace": ("size", "speed", "ability"),
        "background": ("ability", "skillProficiencies", "toolProficiencies", "languageProficiencies", "feats"),
        "feat": ("prerequisite", "ability"),
        "language": ("typicalSpeakers", "script"),
    }.get(kind, ())
    return {field: mechanical_text(raw[field]) for field in fields if raw.get(field) is not None}
SCHEMA = """
CREATE TABLE IF NOT EXISTS reference_version (id TEXT PRIMARY KEY, report TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reference_active (singleton INTEGER PRIMARY KEY CHECK(singleton=1), version TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reference_entry (
 version TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL,
 source TEXT NOT NULL, edition TEXT NOT NULL, page TEXT, text TEXT NOT NULL,
 raw TEXT NOT NULL, warnings TEXT NOT NULL, PRIMARY KEY(version,id)
);
CREATE INDEX IF NOT EXISTS reference_filter ON reference_entry(version,kind,source,edition);
CREATE VIRTUAL TABLE IF NOT EXISTS reference_search USING fts5(version UNINDEXED, id UNINDEXED, name, text, tokenize='unicode61');
CREATE TABLE IF NOT EXISTS reference_policy (campaign_id INTEGER PRIMARY KEY, sources TEXT);
"""


def identity(kind, record):
    parts = [kind, record.get("name", ""), record.get("source", "")]
    parts.extend(str(record.get(key, "")) for key in PARENTS)
    return hashlib.sha256("|".join(parts).casefold().encode()).hexdigest()[:32]


def plain(value):
    """Readable text, never HTML. Preserve tables and nested lists as lines."""
    if isinstance(value, str):
        def tag(match):
            tag_name, body = match.group(1), match.group(2)
            parts = body.split("|")
            if tag_name == "h":
                return "Hit: "
            if tag_name in {"spell", "item", "race", "background", "feat", "class", "condition", "skill"}:
                return parts[2] if len(parts) > 2 and parts[2] else parts[0]
            return parts[0]
        # Repeat to handle nested tags without interpreting arbitrary markup.
        for _ in range(12):
            updated = re.sub(r"\{@(\w+)\s*([^{}]*)\}", tag, value)
            if updated == value:
                break
            value = updated
        return value
    if isinstance(value, list):
        return "\n".join(filter(None, (plain(item) for item in value)))
    if isinstance(value, dict):
        parts = [plain(value[key]) for key in ("name", "caption", "colLabels", "entries", "entry", "items", "rows") if key in value]
        if not parts and value.get("type", "").startswith("ref"):
            parts = [str(value.get(key, "")).split("|")[0] for key in ("classFeature", "subclassFeature", "optionalfeature") if key in value]
        return "\n".join(filter(None, parts))
    return str(value) if value is not None else ""


def normalize(documents):
    records = {}
    duplicates = 0
    def variants(raw):
        yield raw
        for version in raw.get("_versions", []):
            abstract = version.get("_abstract")
            implementations = version.get("_implementations", []) if abstract else [version]
            for implementation in implementations:
                variant = {**copy.deepcopy(raw), **copy.deepcopy(abstract or {}), **copy.deepcopy(implementation)}
                variant.pop("_versions", None)
                variables = implementation.get("_variables", {})
                def substitute(value):
                    if isinstance(value, str):
                        return re.sub(r"\{\{([^{}]+)\}\}", lambda m: str(variables.get(m[1], m[0])), value)
                    if isinstance(value, list):
                        return [substitute(item) for item in value]
                    if isinstance(value, dict):
                        return {k: substitute(v) for k, v in value.items()}
                    return value
                yield substitute(variant)

    for document in documents:
        for kind in TYPES:
            for original in document.get(kind, []):
                if not isinstance(original, dict):
                    raise ValueError(f"Invalid {kind} record")
                for raw in variants(original):
                    raw = copy.deepcopy(raw)
                    if kind == "subrace" and not raw.get("name"):
                        raw["name"] = raw.get("raceName")
                    if not raw.get("source"):
                        raw["source"] = raw.get("raceSource") or raw.get("classSource")
                    if not raw.get("name") or not raw.get("source"):
                        raise ValueError(f"Invalid {kind} record: name and source required")
                    key = identity(kind, raw)
                    if key in records:
                        if records[key][1] != raw:
                            raise ValueError(f"Conflicting identity: {kind} {raw['name']} ({raw['source']})")
                        duplicates += 1
                    records[key] = (kind, raw)

    cache = {}
    def resolve(key, stack=()):
        if key in cache:
            return cache[key]
        kind, raw = records[key]
        result, warnings = copy.deepcopy(raw), []
        if key in stack:
            return result, ["Cyclic inheritance; review original source."]
        parent = raw.get("_copy")
        if parent:
            parent_key = identity(kind, {**{k: raw[k] for k in PARENTS if k in raw}, **parent})
            if parent_key not in records:
                warnings.append("Missing inherited record; review original source.")
            elif parent.get("_mod") or parent.get("_templates"):
                # Do not display unmodified parent rules as if the modifications had been applied.
                warnings.append("Inherited modifications require manual source review.")
            else:
                inherited, inherited_warnings = resolve(parent_key, (*stack, key))
                result = {**inherited, **result}
                warnings.extend(inherited_warnings)
        cache[key] = result, warnings
        return cache[key]

    output = []
    for key, (kind, raw) in records.items():
        resolved, warnings = resolve(key)
        if raw.get("_mod"):
            warnings.append("Variant modifications require manual source review.")
            # Do not expose unchanged parent text as the variant's final rules.
            resolved = {**resolved, "entries": []}
        if kind == "subrace":
            warnings.append("Lineage supplement; consult the parent species for combined traits.")
        edition = {"one": "2024", "classic": "2014"}.get(raw.get("edition"), "unspecified")
        if raw["source"] in {"XPHB", "XDMG", "XMM"}:
            edition = "2024"
        elif raw["source"] in {"PHB", "DMG", "MM"}:
            edition = "2014"
        text = plain(resolved.get("entries", []))
        # Include structured mechanical fields for reference without claiming automation.
        for field, label in FIELD_LABELS.items():
            if field in resolved:
                text += f"\n\n{label}\n" + mechanical_text(resolved[field])
        output.append({"id": key, "kind": kind, "name": raw["name"], "source": raw["source"],
                       "edition": edition, "page": raw.get("page"), "text": text.strip(),
                       "raw": raw, "warnings": warnings})
    return output, duplicates


class ReferenceStore:
    def __init__(self, path):
        self.path = str(path)
        with self.connect() as db:
            db.executescript(SCHEMA)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def import_documents(self, version, documents, files=None):
        if not re.fullmatch(r"[0-9a-f]{40}", version):
            raise ValueError("An exact upstream commit SHA is required")
        entries, duplicates = normalize(documents)
        if not entries:
            raise ValueError("No reference entries found; active catalog unchanged")
        report = {"version": version, "imported_at": datetime.now(timezone.utc).isoformat(),
                  "total": len(entries), "counts": dict(Counter(e["kind"] for e in entries)),
                  "sources": dict(Counter(e["source"] for e in entries)),
                  "editions": dict(Counter(e["edition"] for e in entries)),
                  "duplicates": duplicates, "files": files or [],
                  "review_required": [{"id": e["id"], "name": e["name"], "source": e["source"], "warnings": e["warnings"]} for e in entries if e["warnings"]]}
        with self.connect() as db:
            # Version immutability keeps pinned references stable on repeat imports.
            existing = db.execute("SELECT report FROM reference_version WHERE id=?", (version,)).fetchone()
            if existing:
                return json.loads(existing["report"])
            for entry in entries:
                db.execute("INSERT INTO reference_entry VALUES(?,?,?,?,?,?,?,?,?,?)", (
                    version, entry["id"], entry["kind"], entry["name"], entry["source"], entry["edition"],
                    str(entry["page"]) if entry["page"] is not None else None, entry["text"],
                    json.dumps(entry["raw"]), json.dumps(entry["warnings"])))
                db.execute("INSERT INTO reference_search VALUES(?,?,?,?)", (version, entry["id"], entry["name"], entry["text"]))
            db.execute("INSERT INTO reference_version VALUES(?,?)", (version, json.dumps(report)))
            db.execute("INSERT OR REPLACE INTO reference_active VALUES(1,?)", (version,))
        return report

    @staticmethod
    def require_auth(auth):
        if not auth or auth.get("game_system") != "dnd" or not auth.get("campaign_id") or auth.get("role") not in {"warden", "player"}:
            raise DndError("An authenticated D&D campaign is required", 403)

    @staticmethod
    def policy(db, campaign):
        row = db.execute("SELECT sources FROM reference_policy WHERE campaign_id=?", (campaign,)).fetchone()
        return json.loads(row["sources"]) if row and row["sources"] is not None else None

    def filters(self, db, auth, version=None):
        self.require_auth(auth)
        active = db.execute("SELECT version FROM reference_active WHERE singleton=1").fetchone()
        version = version or (active["version"] if active else "")
        clauses, args = ["e.version=?"], [version]
        sources = self.policy(db, auth["campaign_id"])
        if sources is not None:
            clauses.append("e.source IN (" + ",".join("?" for _ in sources) + ")" if sources else "0")
            args.extend(sources)
        return clauses, args, version

    def metadata(self, auth, version=None):
        with self.connect() as db:
            clauses, args, version = self.filters(db, auth, version)
            rows = db.execute("SELECT kind,source,edition,count(*) AS count FROM reference_entry e WHERE " + " AND ".join(clauses) + " GROUP BY kind,source,edition", args).fetchall()
            result = {"version": version, "total": sum(r["count"] for r in rows),
                      "kinds": {r["kind"]: TYPES[r["kind"]] for r in rows},
                      "sources": sorted({r["source"] for r in rows}), "editions": sorted({r["edition"] for r in rows})}
            if auth["role"] == "warden":
                result["all_sources"] = [r[0] for r in db.execute("SELECT DISTINCT source FROM reference_entry WHERE version=? ORDER BY source", (version,))]
                result["allowed_sources"] = self.policy(db, auth["campaign_id"])
            return result

    def set_policy(self, auth, sources):
        self.require_auth(auth)
        if auth["role"] != "warden":
            raise DndError("Only the DM can set reference sources", 403)
        if sources is not None and (not isinstance(sources, list) or len(sources) > 2000 or any(not isinstance(s, str) or len(s) > 100 for s in sources)):
            raise DndError("Sources must be a list of source codes or null")
        with self.connect() as db:
            db.execute("INSERT OR REPLACE INTO reference_policy VALUES(?,?)", (auth["campaign_id"], json.dumps(sorted(set(sources))) if sources is not None else None))
        return self.metadata(auth)

    def search(self, auth, query="", kind="", source="", edition="", offset=0, limit=30, version=None, level="", school=""):
        if len(query) > 200 or offset < 0 or not 1 <= limit <= 100:
            raise DndError("Invalid search bounds")
        if level and (kind != "spell" or level not in {str(value) for value in range(10)}):
            raise DndError("Invalid spell level")
        if school and (kind != "spell" or school not in SPELL_SCHOOLS):
            raise DndError("Invalid spell school")
        with self.connect() as db:
            clauses, args, version = self.filters(db, auth, version)
            for field, value in (("kind", kind), ("source", source), ("edition", edition)):
                if value:
                    clauses.append(f"e.{field}=?")
                    args.append(value)
            if level:
                clauses.append("CAST(json_extract(e.raw, '$.level') AS INTEGER)=?")
                args.append(int(level))
            if school:
                clauses.append("json_extract(e.raw, '$.school')=?")
                args.append(school)
            words = re.findall(r"\w+", query, re.UNICODE)
            if query.strip() and not words:
                return {"version": version, "total": 0, "items": []}
            if words:
                clauses.append("e.id IN (SELECT id FROM reference_search WHERE reference_search MATCH ? AND version=?)")
                args.extend([" AND ".join('"' + word + '"*' for word in words), version])
            where = " AND ".join(clauses)
            total = db.execute("SELECT count(*) FROM reference_entry e WHERE " + where, args).fetchone()[0]
            rows = db.execute("SELECT id,kind,name,source,edition,page,warnings,raw FROM reference_entry e WHERE " + where + " ORDER BY CASE WHEN lower(name)=lower(?) THEN 0 ELSE 1 END,name COLLATE NOCASE,source,id LIMIT ? OFFSET ?", [*args, query, limit, offset]).fetchall()
            return {"version": version, "total": total, "items": [
                {**{key: r[key] for key in ("id", "kind", "name", "source", "edition", "page")},
                 "warnings": json.loads(r["warnings"]), "metadata": entry_metadata(r["kind"], json.loads(r["raw"])),
                 "creation_support": "reference_only"} for r in rows]}

    def detail(self, auth, entry_id, version=None):
        with self.connect() as db:
            clauses, args, version = self.filters(db, auth, version)
            row = db.execute("SELECT id,kind,name,source,edition,page,text,warnings,raw FROM reference_entry e WHERE " + " AND ".join(clauses) + " AND e.id=?", [*args, entry_id]).fetchone()
            if not row:
                raise DndError("Reference entry not found", 404)
            return {**{key: row[key] for key in ("id", "kind", "name", "source", "edition", "page", "text")},
                    "version": version, "warnings": json.loads(row["warnings"]),
                    "metadata": entry_metadata(row["kind"], json.loads(row["raw"])), "creation_support": "reference_only"}
