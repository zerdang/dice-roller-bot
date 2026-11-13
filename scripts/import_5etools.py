"""Import a pinned 5etools snapshot into private local SQLite storage.

Run from the repository root: python -m scripts.import_5etools --db databases/companion.db
No upstream corpus is copied into tracked source files or the browser bundle.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import re
from urllib.request import Request, urlopen

from functions.reference import ReferenceStore

DEFAULT_COMMIT = "32ef600fab87a585a61dd1a22e9b02dfc58c728a"
FILES = ["backgrounds.json", "races.json", "feats.json", "optionalfeatures.json", "charcreationoptions.json",
         "items.json", "items-base.json", "conditionsdiseases.json", "actions.json", "skills.json", "languages.json", "senses.json"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, help="Private companion SQLite database")
    parser.add_argument("--commit", default=DEFAULT_COMMIT)
    parser.add_argument("--cache", default="databases/reference-cache")
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9a-f]{40}", args.commit):
        parser.error("--commit must be a full commit SHA")
    cache = Path(args.cache).resolve() / args.commit
    manifest = {}

    def fetch(relative):
        if not re.fullmatch(r"[a-zA-Z0-9_./-]+\.json", relative) or ".." in relative.split("/"):
            raise ValueError("Unsafe upstream file path")
        target = cache / relative
        if target.exists():
            content = target.read_bytes()
        else:
            url = f"https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/{args.commit}/data/{relative}"
            with urlopen(Request(url, headers={"User-Agent": "TabletopReferenceImporter/1.0"}), timeout=60) as response:
                content = response.read(40 * 1024 * 1024 + 1)
            if len(content) > 40 * 1024 * 1024:
                raise ValueError("Upstream file exceeds import size limit")
            json.loads(content)  # Never cache a failed/invalid response.
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
        manifest[relative] = hashlib.sha256(content).hexdigest()
        return json.loads(content)

    files = list(FILES)
    for directory in ("class", "spells"):
        index = fetch(f"{directory}/index.json")
        files.extend(f"{directory}/{filename}" for filename in index.values())
    files = sorted(set(files))
    with ThreadPoolExecutor(max_workers=4) as pool:
        documents = list(pool.map(fetch, files))
    Path(args.db).resolve().parent.mkdir(parents=True, exist_ok=True)
    report = ReferenceStore(args.db).import_documents(args.commit, documents,
        [{"path": path, "sha256": digest} for path, digest in sorted(manifest.items())])
    print(json.dumps({k: v for k, v in report.items() if k not in {"review_required", "files", "sources"}}, indent=2))
    print(f"Records needing source review: {len(report['review_required'])}")


if __name__ == "__main__":
    main()
