# HF Racing

Local racing client + Hugging Face Space game server (lobbies / match relay).

**License:** [GPL-3.0](LICENSE)  
**GitHub:** https://github.com/1024-m/F1-RL-env

## Hugging Face Space (this project only)

- Space: https://huggingface.co/spaces/1024m/HF-Racing
- Play: https://1024m-hf-racing.hf.space
- Board: https://1024m-hf-racing.hf.space/board

## Start

```bash
# after clone: pull large GLBs from HF (≥10MB files are not in git)
python3 tools/fetch_assets.py

python3 start.py
```

Or:

| OS | Command |
|----|---------|
| macOS / Linux | `bash start.sh` |
| Windows | double-click `start.bat` or run `start.bat` |

```bash
# copy .env.example → .env.local, then set your token
HF_TOKEN=hf_xxxxxxxx
HF_SPACE_URL=https://1024m-hf-racing.hf.space
PORT=8080
```

## Modes

- **Sandbox** — solo test drive. Starts immediately on seat claim. Default car: Porsche GT2 RS.
- **MVP** — up to 8 players. Starts after **30s** with the **same ≥2 players** seated. Join/leave resets the timer. Cars assigned randomly.

## Large assets (HF dataset)

Public dataset: https://huggingface.co/datasets/1024m/F1-RL-HF-Assets  

Stores **7 files** (same local paths): Shanghai `track.glb` + all 6 car GLBs.

```bash
# maintainers: upload map + 6 cars
python3 tools/push_assets_dataset.py

# anyone: download them into local assets/ paths
python3 tools/fetch_assets.py
```

## Push Space

```bash
python3 tools/push_space.py
```

Updates **only** `1024m/HF-Racing`.
