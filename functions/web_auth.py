"""Discord OAuth identities, browser sessions, and website invitations.

Only hashes of bearer credentials are persisted. Discord access tokens are used
for the identity request and deliberately never reach this store.
"""

from __future__ import annotations

import hashlib
import json
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator


AUTH_SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS web_identity (
    discord_user_id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    global_name TEXT,
    avatar TEXT,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS web_oauth_state (
    state_hash TEXT PRIMARY KEY,
    browser_hash TEXT NOT NULL,
    invite_hash TEXT,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS web_session (
    session_hash TEXT PRIMARY KEY,
    discord_user_id TEXT NOT NULL REFERENCES web_identity(discord_user_id) ON DELETE CASCADE,
    csrf_hash TEXT NOT NULL,
    active_campaign_id INTEGER REFERENCES campaign(id) ON DELETE SET NULL,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS web_session_user ON web_session(discord_user_id);
CREATE TABLE IF NOT EXISTS campaign_invite (
    token_hash TEXT PRIMARY KEY,
    campaign_id INTEGER NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
    created_by_discord_user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    used_by_discord_user_id TEXT,
    revoked_at INTEGER,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS campaign_invite_campaign ON campaign_invite(campaign_id);
"""


def credential() -> str:
    return secrets.token_urlsafe(32)


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


class AuthError(ValueError):
    """A safe authentication error suitable for an HTTP response."""


class WebAuthStore:
    def __init__(self, path: str, session_ttl: int = 60 * 60 * 24 * 7):
        self.path = path
        self.session_ttl = session_ttl
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript(AUTH_SCHEMA)

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

    def create_state(self, browser: str, invite_token: str | None = None, ttl: int = 600) -> str:
        state = credential()
        now = int(time.time())
        invite_hash = None
        with self.connect() as db:
            db.execute("DELETE FROM web_oauth_state WHERE expires_at < ?", (now,))
            if invite_token:
                invite_hash = digest(invite_token)
                invite = db.execute(
                    "SELECT 1 FROM campaign_invite WHERE token_hash=? AND used_at IS NULL "
                    "AND revoked_at IS NULL AND expires_at>=?", (invite_hash, now)
                ).fetchone()
                if not invite:
                    raise AuthError("This invitation is invalid, expired, or already used.")
            db.execute(
                "INSERT INTO web_oauth_state(state_hash,browser_hash,invite_hash,expires_at,created_at) VALUES(?,?,?,?,?)",
                (digest(state), digest(browser), invite_hash, now + ttl, now),
            )
        return state

    def consume_state(self, state: str, browser: str) -> str | None:
        now = int(time.time())
        with self.connect() as db:
            row = db.execute("SELECT * FROM web_oauth_state WHERE state_hash=?", (digest(state),)).fetchone()
            if row:
                db.execute("DELETE FROM web_oauth_state WHERE state_hash=?", (digest(state),))
            if not row or row["expires_at"] < now or not secrets.compare_digest(row["browser_hash"], digest(browser)):
                raise AuthError("The sign-in request expired or did not match this browser.")
            return row["invite_hash"]

    def upsert_identity(self, identity: dict[str, Any]) -> str:
        user_id = str(identity.get("id", ""))
        if not user_id.isdigit():
            raise AuthError("Discord returned an invalid identity.")
        username = str(identity.get("username", ""))[:100]
        if not username:
            raise AuthError("Discord returned an incomplete identity.")
        with self.connect() as db:
            db.execute(
                "INSERT INTO web_identity(discord_user_id,username,global_name,avatar,updated_at) VALUES(?,?,?,?,?) "
                "ON CONFLICT(discord_user_id) DO UPDATE SET username=excluded.username,global_name=excluded.global_name,"
                "avatar=excluded.avatar,updated_at=excluded.updated_at",
                (user_id, username, identity.get("global_name"), identity.get("avatar"), int(time.time())),
            )
        return user_id

    def create_session(self, discord_user_id: str, previous: str | None = None) -> tuple[str, str]:
        session, csrf = credential(), credential()
        now = int(time.time())
        with self.connect() as db:
            if previous:
                db.execute("UPDATE web_session SET revoked_at=? WHERE session_hash=?", (now, digest(previous)))
            db.execute(
                "INSERT INTO web_session(session_hash,discord_user_id,csrf_hash,expires_at,created_at,last_seen_at) "
                "VALUES(?,?,?,?,?,?)",
                (digest(session), discord_user_id, digest(csrf), now + self.session_ttl, now, now),
            )
        return session, csrf

    def session(self, token: str | None) -> dict[str, Any] | None:
        if not token:
            return None
        now = int(time.time())
        with self.connect() as db:
            row = db.execute(
                "SELECT s.*,i.username,i.global_name,i.avatar FROM web_session s "
                "JOIN web_identity i ON i.discord_user_id=s.discord_user_id WHERE s.session_hash=?",
                (digest(token),),
            ).fetchone()
            if not row or row["revoked_at"] is not None or row["expires_at"] < now:
                return None
            db.execute("UPDATE web_session SET last_seen_at=? WHERE session_hash=?", (now, digest(token)))
            return dict(row)

    def revoke_session(self, token: str | None) -> None:
        if token:
            with self.connect() as db:
                db.execute("UPDATE web_session SET revoked_at=? WHERE session_hash=?", (int(time.time()), digest(token)))

    def check_csrf(self, session: dict[str, Any], value: str | None) -> bool:
        return bool(value) and secrets.compare_digest(session["csrf_hash"], digest(value))

    def memberships(self, discord_user_id: str) -> list[dict[str, Any]]:
        with self.connect() as db:
            rows = db.execute(
                "SELECT c.id,c.name,c.game_system,'warden' role FROM campaign c "
                "WHERE c.owner_discord_user_id=? UNION ALL "
                "SELECT c.id,c.name,c.game_system,'player' role FROM campaign c "
                "JOIN character ch ON ch.campaign_id=c.id WHERE ch.discord_user_id=? "
                "AND (c.owner_discord_user_id IS NULL OR c.owner_discord_user_id<>?) ORDER BY name",
                (discord_user_id, discord_user_id, discord_user_id),
            ).fetchall()
            return [dict(row) for row in rows]

    def authorize(self, discord_user_id: str, campaign_id: int | None) -> dict[str, Any] | None:
        if campaign_id is None:
            return None
        with self.connect() as db:
            campaign = db.execute("SELECT * FROM campaign WHERE id=?", (campaign_id,)).fetchone()
            if not campaign:
                return None
            if campaign["owner_discord_user_id"] == discord_user_id:
                return {"role": "warden", "campaign_id": campaign_id, "character_id": None,
                        "discord_user_id": discord_user_id, "game_system": campaign["game_system"]}
            character = db.execute(
                "SELECT id FROM character WHERE campaign_id=? AND discord_user_id=?",
                (campaign_id, discord_user_id),
            ).fetchone()
            if not character:
                return None
            return {"role": "player", "campaign_id": campaign_id, "character_id": character["id"],
                    "discord_user_id": discord_user_id, "game_system": campaign["game_system"]}

    def select_campaign(self, session_token: str, discord_user_id: str, campaign_id: int) -> bool:
        if not self.authorize(discord_user_id, campaign_id):
            return False
        with self.connect() as db:
            db.execute("UPDATE web_session SET active_campaign_id=? WHERE session_hash=?",
                       (campaign_id, digest(session_token)))
        return True

    def create_campaign(self, discord_user_id: str, name: str, game_system: str = "dnd") -> dict[str, Any]:
        name = str(name).strip()[:100]
        if not name:
            raise AuthError("Campaign name is required.")
        if game_system not in {"dnd", "mothership"}:
            raise AuthError("Unsupported game system.")
        guild_id = "web:" + secrets.token_hex(16)
        now = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime())
        with self.connect() as db:
            campaign_id = db.execute(
                "INSERT INTO campaign(guild_id,name,game_system,owner_discord_user_id,warden_token_hash,created_at) "
                "VALUES(?,?,?,?,?,?)",
                (guild_id, name, game_system, discord_user_id, digest(credential()), now),
            ).lastrowid
        return {"id": campaign_id, "name": name, "game_system": game_system, "role": "warden"}

    def create_invite(self, auth: dict[str, Any], expires_in: int = 60 * 60 * 24 * 7) -> str:
        if auth["role"] != "warden":
            raise AuthError("Only the DM can invite players.")
        token, now = credential(), int(time.time())
        with self.connect() as db:
            db.execute(
                "INSERT INTO campaign_invite(token_hash,campaign_id,created_by_discord_user_id,expires_at,created_at) "
                "VALUES(?,?,?,?,?)",
                (digest(token), auth["campaign_id"], auth["discord_user_id"], now + expires_in, now),
            )
        return token

    def list_invites(self, auth: dict[str, Any]) -> list[dict[str, Any]]:
        if auth["role"] != "warden":
            raise AuthError("Only the DM can manage invitations.")
        now = int(time.time())
        with self.connect() as db:
            rows = db.execute(
                "SELECT token_hash,expires_at,used_at,revoked_at,created_at FROM campaign_invite "
                "WHERE campaign_id=? ORDER BY created_at DESC LIMIT 50", (auth["campaign_id"],)
            ).fetchall()
        return [{**dict(row), "status": "revoked" if row["revoked_at"] else "used" if row["used_at"]
                 else "expired" if row["expires_at"] < now else "active"} for row in rows]

    def revoke_invite(self, auth: dict[str, Any], token_hash: str) -> bool:
        if auth["role"] != "warden":
            return False
        with self.connect() as db:
            return bool(db.execute(
                "UPDATE campaign_invite SET revoked_at=? WHERE token_hash=? AND campaign_id=? AND used_at IS NULL",
                (int(time.time()), token_hash, auth["campaign_id"]),
            ).rowcount)

    def accept_invite(self, token: str, discord_user_id: str, display_name: str) -> int:
        return self.accept_invite_hash(digest(token), discord_user_id, display_name)

    def accept_invite_hash(self, invite_hash: str, discord_user_id: str, display_name: str) -> int:
        now = int(time.time())
        display_name = str(display_name).strip()[:100] or "Player"
        created_at = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime())
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            invite = db.execute("SELECT * FROM campaign_invite WHERE token_hash=?", (invite_hash,)).fetchone()
            if not invite or invite["used_at"] is not None or invite["revoked_at"] is not None or invite["expires_at"] < now:
                raise AuthError("This invitation is invalid, expired, revoked, or already used.")
            campaign = db.execute("SELECT owner_discord_user_id FROM campaign WHERE id=?", (invite["campaign_id"],)).fetchone()
            if campaign["owner_discord_user_id"] == discord_user_id:
                raise AuthError("The campaign DM cannot accept a player invitation.")
            existing = db.execute(
                "SELECT id FROM character WHERE campaign_id=? AND discord_user_id=?",
                (invite["campaign_id"], discord_user_id),
            ).fetchone()
            if not existing:
                db.execute(
                    "INSERT INTO character(campaign_id,discord_user_id,name,player_token_hash,created_at) VALUES(?,?,?,?,?)",
                    (invite["campaign_id"], discord_user_id, display_name, digest(credential()), created_at),
                )
            changed = db.execute(
                "UPDATE campaign_invite SET used_at=?,used_by_discord_user_id=? WHERE token_hash=? "
                "AND used_at IS NULL AND revoked_at IS NULL",
                (now, discord_user_id, invite_hash),
            ).rowcount
            if not changed:
                raise AuthError("This invitation has already been used.")
            return int(invite["campaign_id"])
