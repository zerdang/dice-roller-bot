import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from scripts.backup_companion import backup


class CompanionBackupTests(unittest.TestCase):
    def test_database_and_assets_are_backed_up_together(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            database = root / "source.db"
            assets = root / "assets"
            assets.mkdir()
            (assets / "map.png").write_bytes(b"map")
            with closing(sqlite3.connect(database)) as db:
                db.execute("CREATE TABLE example(value TEXT)")
                db.execute("INSERT INTO example VALUES('preserved')")
                db.commit()
            result = backup(database, assets, root / "backups")
            with closing(sqlite3.connect(result / "companion.db")) as db:
                self.assertEqual("preserved", db.execute("SELECT value FROM example").fetchone()[0])
            self.assertEqual(b"map", (result / "companion-assets" / "map.png").read_bytes())
            self.assertTrue((result / "manifest.json").is_file())


if __name__ == "__main__":
    unittest.main()
