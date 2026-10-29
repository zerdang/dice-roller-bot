"""Permanently reset only the local tabletop companion SQLite database."""

from __future__ import annotations

import configparser
import sys
from pathlib import Path


CONFIRMATION = "WIPE"


def companion_database(project_root: Path) -> Path:
    config_path = project_root / "config"
    parser = configparser.ConfigParser()
    if not parser.read(config_path, encoding="utf-8"):
        raise RuntimeError(f"Could not read {config_path}")

    configured = parser.get("db", "companion", fallback="databases/companion.db")
    candidate = Path(configured)
    if not candidate.is_absolute():
        candidate = project_root / candidate
    database = candidate.resolve()

    try:
        database.relative_to(project_root.resolve())
    except ValueError as error:
        raise RuntimeError(
            f"Refusing to wipe a database outside the project: {database}"
        ) from error
    if database == project_root.resolve():
        raise RuntimeError("Refusing to use the project directory as a database path")
    return database


def wipe_database(database: Path) -> list[Path]:
    targets = [database, Path(f"{database}-wal"), Path(f"{database}-shm")]
    removed = []
    for target in targets:
        if target.exists():
            target.unlink()
            removed.append(target)
    return removed


def main() -> int:
    project_root = Path(__file__).resolve().parent
    try:
        database = companion_database(project_root)
    except (configparser.Error, RuntimeError) as error:
        print(f"ERROR: {error}")
        return 1

    print("LOCAL TABLETOP COMPANION DATABASE RESET")
    print(f"Target: {database}")
    print()
    print("This permanently removes local campaigns, characters, stats, inventory,")
    print("warden/player links, and the companion roll feed.")
    print("It does NOT delete Discord messages, users, servers, or other bot databases.")
    print()
    print("Stop the bot before continuing.")
    if input(f'Type {CONFIRMATION} to permanently erase this database: ').strip() != CONFIRMATION:
        print("Cancelled. Nothing was removed.")
        return 2

    try:
        removed = wipe_database(database)
    except PermissionError:
        print("ERROR: The database is in use. Stop the bot and run this script again.")
        return 1
    except OSError as error:
        print(f"ERROR: Could not remove the database: {error}")
        return 1

    if removed:
        print("Local companion data wiped:")
        for path in removed:
            print(f"  {path}")
    else:
        print("The local companion database does not exist; nothing needed removal.")
    print("It will be recreated empty the next time the bot starts.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
