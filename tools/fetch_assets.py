#!/usr/bin/env python3
"""Download large assets from the public HF dataset into local paths.

  python3 tools/fetch_assets.py

Reads tools/assets_manifest.json (or the Hub manifest) and writes each file
back under the same relative path (e.g. assets/cars/porsche_gt2rs.glb).
Skips files that already exist with the expected size.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from huggingface_hub import hf_hub_download
from huggingface_hub.utils import EntryNotFoundError

ROOT = Path(__file__).resolve().parents[1]
DATASET_ID = "1024m/F1-RL-HF-Assets"
LOCAL_MANIFEST = ROOT / "tools" / "assets_manifest.json"


def _load_manifest(token: str | None) -> dict:
    if LOCAL_MANIFEST.is_file():
        return json.loads(LOCAL_MANIFEST.read_text())
    # Fall back to Hub copy (public — token optional).
    try:
        path = hf_hub_download(
            repo_id=DATASET_ID,
            repo_type="dataset",
            filename="manifest.json",
            token=token,
        )
        return json.loads(Path(path).read_text())
    except Exception as err:
        raise SystemExit(
            f"No local manifest at {LOCAL_MANIFEST} and Hub fetch failed: {err}"
        ) from err


def main() -> int:
    load_dotenv(ROOT / ".env.local")
    token = (os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN") or "").strip() or None

    manifest = _load_manifest(token)
    dataset = manifest.get("dataset") or DATASET_ID
    files = manifest.get("files") or []
    if not files:
        print("Manifest has no files")
        return 1

    print(f"Dataset: {dataset}")
    ok = 0
    for entry in files:
        rel = entry["path"]
        expect = int(entry.get("bytes") or 0)
        dest = ROOT / rel
        if dest.is_file() and (expect <= 0 or dest.stat().st_size == expect):
            print(f"  skip  {rel} (already present)")
            ok += 1
            continue

        dest.parent.mkdir(parents=True, exist_ok=True)
        print(f"  fetch {rel} …")
        try:
            cached = hf_hub_download(
                repo_id=dataset,
                repo_type="dataset",
                filename=rel,
                token=token,
            )
        except EntryNotFoundError:
            print(f"  FAIL  missing on Hub: {rel}")
            continue

        data = Path(cached).read_bytes()
        if expect and len(data) != expect:
            print(f"  WARN  size {len(data)} != manifest {expect}")
        dest.write_bytes(data)
        print(f"  ok    {rel} ({len(data) / (1024 * 1024):.1f} MiB)")
        ok += 1

    print(f"Done ({ok}/{len(files)}).")
    print(f"Hub: https://huggingface.co/datasets/{dataset}")
    return 0 if ok == len(files) else 2


if __name__ == "__main__":
    raise SystemExit(main())
