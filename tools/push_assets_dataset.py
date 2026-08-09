#!/usr/bin/env python3
"""Upload large local assets (≥10MB) to a public HF dataset.

  python3 tools/push_assets_dataset.py

Copies files under assets/ into dataset repo 1024m/F1-RL-HF-Assets,
keeping the same relative paths (e.g. assets/cars/porsche_gt2rs.glb).
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from huggingface_hub import HfApi, whoami

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
MIN_BYTES = 10 * 1024 * 1024  # 10 MiB
DATASET_ID = "1024m/F1-RL-HF-Assets"
MANIFEST_NAME = "manifest.json"


def _large_files() -> list[Path]:
    if not ASSETS.is_dir():
        raise FileNotFoundError(ASSETS)
    out: list[Path] = []
    for p in ASSETS.rglob("*"):
        if p.is_file() and p.stat().st_size >= MIN_BYTES:
            out.append(p)
    return sorted(out)


def main() -> int:
    load_dotenv(ROOT / ".env.local")
    token = (os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN") or "").strip()
    if not token:
        print("Set HF_TOKEN in .env.local first")
        return 1

    api = HfApi(token=token)
    me = whoami(token=token)
    user = me.get("name") or me.get("fullname")
    print(f"HF user: {user}")
    print(f"Dataset: {DATASET_ID} (public)")

    files = _large_files()
    if not files:
        print(f"No files ≥ {MIN_BYTES} bytes under {ASSETS}")
        return 1

    api.create_repo(
        repo_id=DATASET_ID,
        repo_type="dataset",
        private=False,
        exist_ok=True,
    )

    entries = []
    for path in files:
        rel = path.relative_to(ROOT).as_posix()  # assets/...
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
        "min_bytes": MIN_BYTES,
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
        commit_message="Update manifest.json",
    )

    print(f"Done. https://huggingface.co/datasets/{DATASET_ID}")
    print(f"Local manifest: {manifest_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
