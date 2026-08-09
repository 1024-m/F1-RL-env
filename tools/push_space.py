#!/usr/bin/env python3
"""Assemble server + game client and push to HF Space (Docker SDK)."""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "server"
STAGE = ROOT / ".space_build"
SPACE_NAME = "HF-Racing"


def assemble() -> Path:
    if STAGE.exists():
        shutil.rmtree(STAGE)
    STAGE.mkdir(parents=True)

    for name in ("app.py", "lobbies.py", "relay.py", "requirements.txt", "Dockerfile", "README.md"):
        src = SERVER / name
        if not src.is_file():
            raise FileNotFoundError(src)
        shutil.copy2(src, STAGE / name)

    www = STAGE / "www"
    www.mkdir()
    shutil.copy2(ROOT / "index.html", www / "index.html")
    shutil.copytree(ROOT / "js", www / "js")
    shutil.copytree(ROOT / "css", www / "css")
    assets = ROOT / "assets"
    if not assets.is_dir():
        raise FileNotFoundError(assets)
    shutil.copytree(assets, www / "assets")
    return STAGE


def main() -> int:
    load_dotenv(ROOT / ".env.local")
    token = (os.environ.get("HF_TOKEN") or "").strip()
    if not token:
        print("Set HF_TOKEN in .env.local first")
        return 1

    try:
        from huggingface_hub import HfApi, create_repo
    except ImportError:
        print("pip install huggingface_hub")
        return 1

    who = httpx.get(
        "https://huggingface.co/api/whoami-v2",
        headers={"Authorization": f"Bearer {token}"},
        timeout=20,
    )
    if who.status_code != 200:
        print(f"HF login failed ({who.status_code})")
        return 1
    user = who.json().get("name")
    if not user:
        print("No username from HF")
        return 1

    print("Assembling Space bundle (server + www client)…")
    stage = assemble()
    size_mb = sum(p.stat().st_size for p in stage.rglob("*") if p.is_file()) / (1024 * 1024)
    print(f"Bundle size ≈ {size_mb:.1f} MB → {stage}")

    repo_id = f"{user}/{SPACE_NAME}"
    api = HfApi(token=token)
    try:
        create_repo(repo_id, repo_type="space", space_sdk="docker", exist_ok=True, token=token)
    except Exception as exc:
        print(f"create_repo: {exc}")

    print(f"Uploading to {repo_id}…")
    api.upload_folder(
        folder_path=str(stage),
        repo_id=repo_id,
        repo_type="space",
        token=token,
        ignore_patterns=[".venv/**", "__pycache__/**", "*.pyc", ".git/**"],
    )

    slug = SPACE_NAME.replace("_", "-").replace(" ", "-").lower()
    space_url = f"https://{user.lower()}-{slug}.hf.space"

    env_path = ROOT / ".env.local"
    text = env_path.read_text() if env_path.exists() else ""
    lines = []
    found = False
    for line in text.splitlines():
        if line.startswith("HF_SPACE_URL="):
            lines.append(f"HF_SPACE_URL={space_url}")
            found = True
        else:
            lines.append(line)
    if not found:
        lines.append(f"HF_SPACE_URL={space_url}")
    env_path.write_text("\n".join(lines) + "\n")

    print(f"Pushed {repo_id}")
    print(f"Play / spectate: {space_url}")
    print(f"Lobby board: {space_url}/board")
    print("Wrote HF_SPACE_URL into .env.local")
    return 0


if __name__ == "__main__":
    sys.exit(main())
