#!/usr/bin/env python3
"""Upload map + all 6 cars to the public HF dataset.

  python3 tools/push_assets_dataset.py

Paths match local layout (e.g. assets/cars/porsche_gt2rs.glb).
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from huggingface_hub import HfApi, whoami

ROOT = Path(__file__).resolve().parents[1]
DATASET_ID = "1024m/F1-RL-HF-Assets"
MANIFEST_NAME = "manifest.json"

# Map + 6 cars (exactly these 7).
ASSET_PATHS = [
    "assets/maps/shanghai/track.glb",
    "assets/cars/porsche_gt2rs.glb",
    "assets/cars/corvette_zr1.glb",
    "assets/cars/ford_gt.glb",
    "assets/cars/lambo_sc18.glb",
    "assets/cars/mclaren_600lt.glb",
    "assets/cars/mustang_roush.glb",
]


def main() -> int:
    load_dotenv(ROOT / ".env.local")
    token = (os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN") or "").strip()
    if not token:
        print("Set HF_TOKEN in .env.local first")
        return 1

    api = HfApi(token=token)
    me = whoami(token=token)
    print(f"HF user: {me.get('name') or me.get('fullname')}")
    print(f"Dataset: {DATASET_ID} (public) — {len(ASSET_PATHS)} files")

    missing = [p for p in ASSET_PATHS if not (ROOT / p).is_file()]
    if missing:
        print("Missing local files:")
        for p in missing:
            print(f"  {p}")
        return 1

    api.create_repo(
        repo_id=DATASET_ID,
        repo_type="dataset",
        private=False,
        exist_ok=True,
    )

    entries = []
    for rel in ASSET_PATHS:
        path = ROOT / rel
        size = path.stat().st_size
        print(f"  upload {rel} ({size / (1024 * 1024):.1f} MiB)")
        api.upload_file(
            path_or_fileobj=str(path),
            path_in_repo=rel,
            repo_id=DATASET_ID,
            repo_type="dataset",
            commit_message=f"Add {rel}",
        )
        entries.append({"path": rel, "bytes": size})

    manifest = {
        "dataset": DATASET_ID,
        "files": entries,
    }
    manifest_path = ROOT / "tools" / "assets_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"  upload {MANIFEST_NAME}")
    api.upload_file(
        path_or_fileobj=str(manifest_path),
        path_in_repo=MANIFEST_NAME,
        repo_id=DATASET_ID,
        repo_type="dataset",
        commit_message="Update manifest.json (map + 6 cars)",
    )

    print(f"Done. https://huggingface.co/datasets/{DATASET_ID}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
