import configparser
import tempfile
import unittest
from pathlib import Path

from wipe_local_database import companion_database, wipe_database


class LocalDatabaseWipeTests(unittest.TestCase):
    def test_only_companion_database_and_sidecars_are_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "config").write_text("[db]\ncompanion = data/tabletop.db\n", encoding="utf-8")
            database = root / "data" / "tabletop.db"
            database.parent.mkdir()
            targets = [database, Path(f"{database}-wal"), Path(f"{database}-shm")]
            for target in targets:
                target.write_bytes(b"test")
            unrelated = root / "data" / "server.db"
            unrelated.write_bytes(b"keep")

            resolved = companion_database(root)
            removed = wipe_database(resolved)

            self.assertEqual(database.resolve(), resolved)
            self.assertEqual(targets, removed)
            self.assertTrue(unrelated.exists())
            self.assertTrue(all(not target.exists() for target in targets))

    def test_database_outside_project_is_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "config").write_text("[db]\ncompanion = ../outside.db\n", encoding="utf-8")
            with self.assertRaises(RuntimeError):
                companion_database(root)


if __name__ == "__main__":
    unittest.main()
