"""Create a paired SQLite/asset backup while application writers are stopped."""

import argparse
import json
import shutil
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path


def backup(database: Path, assets: Path, output: Path) -> Path:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    destination = output / f"companion-{timestamp}"
    destination.mkdir(parents=True)
    with closing(sqlite3.connect(database)) as source, closing(sqlite3.connect(destination / "companion.db")) as target:
        source.backup(target)
    if assets.exists():
        shutil.copytree(assets, destination / "companion-assets")
    manifest = {
        "created_at": timestamp,
        "database_source": str(database.resolve()),
        "assets_source": str(assets.resolve()),
        "note": "Restore database and assets together while all writers are stopped.",
    }
    (destination / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return destination


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--assets", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not args.database.is_file():
        parser.error("database does not exist")
    print(backup(args.database, args.assets, args.output))


if __name__ == "__main__":
    main()
