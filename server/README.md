---
title: HF-Racing
emoji: 🏎️
colorFrom: red
colorTo: yellow
sdk: docker
app_port: 7860
pinned: false
---

# HF Racing

Public **match server** + lobby board + **spectate** (no HF login).

- **URL:** https://1024m-hf-racing.hf.space
- **Board / status:** [`/board`](./board)
- **Spectate:** Spectate button on a live lobby (no account)
- **Play:** local HF Racing only (`bash start.sh` + `HF_TOKEN`) — Space rejects anonymous seat claims

Modes: **sandbox** (solo) · **mvp** (≥2 players, 30s stable roster then start)

APIs: `/api/health`, `/api/lobbies`, `/api/config`  
Match WS: `/ws/match/{mode}/{lobby_id}?user=...&role=play|spectate`
