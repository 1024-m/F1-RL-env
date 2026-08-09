"""Lobby board: sandbox (solo) + mvp (multiplayer). Seat claims are server-authoritative."""

from __future__ import annotations

import random
import string
import time
import uuid
from typing import Any, Optional

_LETTERS = string.ascii_uppercase
SANDBOX_IDS = [f"0{ch}" for ch in _LETTERS[:10]]  # 0A … 0J
MVP_IDS = [f"M{ch}" for ch in _LETTERS[:8]]  # MA … MH

SANDBOX_CAP = 1
MVP_CAP = 8

# MVP: start only after roster (≥2 players) is unchanged for this long.
MVP_MIN_PLAYERS = 2
MVP_STABLE_SEC = 30.0

SEAT_STALE_SEC = 8.0
STARTING_TIMEOUT_SEC = 40.0
LIVE_STALE_SEC = 40.0

# Car assets under assets/cars/<id>.glb
CAR_IDS = [
    "porsche_gt2rs",
    "corvette_zr1",
    "ford_gt",
    "lambo_sc18",
    "mclaren_600lt",
    "mustang_roush",
]
DEFAULT_CAR = "mclaren_600lt"


def _now() -> float:
    return time.time()


def _empty_sandbox(lobby_id: str) -> dict[str, Any]:
    return {
        "id": lobby_id,
        "mode": "sandbox",
        "seats": {f"S-{i}": None for i in range(1, SANDBOX_CAP + 1)},
        "status": "open",  # open | starting | live
        "last_change": _now(),
        "match_id": None,
        "_stable_since": None,
        "_roster_sig": "",
        "_cars": {},
    }


def _empty_mvp(lobby_id: str) -> dict[str, Any]:
    seats: dict[str, Optional[str]] = {f"P-{i}": None for i in range(1, MVP_CAP + 1)}
    return {
        "id": lobby_id,
        "mode": "mvp",
        "seats": seats,
        "status": "open",
        "last_change": _now(),
        "match_id": None,
        "_stable_since": None,
        "_roster_sig": "",
        "_cars": {},
    }


def _roster_sig(seats: dict[str, Any]) -> str:
    """Stable signature of who occupies which seat."""
    parts = [f"{seat}={user or ''}" for seat, user in sorted(seats.items())]
    return "|".join(parts)


class LobbyBoard:
    def __init__(self) -> None:
        self.lobbies: dict[str, dict[str, Any]] = {}
        for lid in SANDBOX_IDS:
            self.lobbies[lid] = _empty_sandbox(lid)
        for lid in MVP_IDS:
            self.lobbies[lid] = _empty_mvp(lid)
        # username -> (lobby_id, seat)
        self.by_user: dict[str, tuple[str, str]] = {}

    def snapshot(self) -> dict[str, Any]:
        self._tick_stale_and_start()
        return {
            "sandbox": [self._public(self.lobbies[lid]) for lid in SANDBOX_IDS],
            "mvp": [self._public(self.lobbies[lid]) for lid in MVP_IDS],
            "serverTime": _now(),
        }

    def _public(self, lobby: dict[str, Any]) -> dict[str, Any]:
        filled = sum(1 for v in lobby["seats"].values() if v)
        countdown = None
        if (
            lobby["mode"] == "mvp"
            and lobby["status"] == "open"
            and filled >= MVP_MIN_PLAYERS
            and lobby.get("_stable_since") is not None
        ):
            remaining = MVP_STABLE_SEC - (_now() - float(lobby["_stable_since"]))
            countdown = max(0.0, round(remaining, 1))
        return {
            "id": lobby["id"],
            "mode": lobby["mode"],
            "seats": dict(lobby["seats"]),
            "status": lobby["status"],
            "lastChange": lobby["last_change"],
            "matchId": lobby["match_id"],
            "filled": filled,
            "capacity": len(lobby["seats"]),
            "countdown": countdown,
        }

    def _clear_user(self, username: str) -> None:
        prev = self.by_user.pop(username, None)
        if not prev:
            return
        lid, seat = prev
        lobby = self.lobbies.get(lid)
        if lobby and lobby["seats"].get(seat) == username:
            lobby["seats"][seat] = None
            lobby.get("_avatars", {}).pop(username, None)
            lobby.get("_hb", {}).pop(username, None)
            lobby.get("_cars", {}).pop(username, None)
            lobby["last_change"] = _now()
            self._note_roster_change(lobby)
            if lobby["status"] in ("live", "starting") and not any(lobby["seats"].values()):
                self._reset_lobby(lobby)

    def _note_roster_change(self, lobby: dict[str, Any]) -> None:
        """Join/leave resets MVP stability timer."""
        sig = _roster_sig(lobby["seats"])
        lobby["_roster_sig"] = sig
        filled = sum(1 for v in lobby["seats"].values() if v)
        if lobby["mode"] == "mvp" and lobby["status"] == "open" and filled >= MVP_MIN_PLAYERS:
            lobby["_stable_since"] = _now()
        else:
            lobby["_stable_since"] = None

    def _reset_lobby(self, lobby: dict[str, Any]) -> None:
        mode = lobby["mode"]
        lid = lobby["id"]
        if mode == "sandbox":
            self.lobbies[lid] = _empty_sandbox(lid)
        else:
            self.lobbies[lid] = _empty_mvp(lid)

    def leave(self, username: str) -> dict[str, Any]:
        self._clear_user(username)
        return {"ok": True}

    def claim(
        self,
        mode: str,
        lobby_id: str,
        username: str,
        seat: str,
        avatar_url: str | None = None,
        car_id: str | None = None,
    ) -> dict[str, Any]:
        username = (username or "").strip()
        if not username:
            return {"ok": False, "error": "username required"}
        lobby = self.lobbies.get(lobby_id)
        if not lobby or lobby["mode"] != mode:
            return {"ok": False, "error": "lobby not found"}
        if seat not in lobby["seats"]:
            return {"ok": False, "error": "invalid seat"}
        if lobby["status"] in ("live", "starting"):
            return {"ok": False, "error": "match already starting"}
        if lobby["seats"][seat] is not None:
            return {"ok": False, "error": "seat taken"}

        self._clear_user(username)
        lobby["seats"][seat] = username
        lobby["last_change"] = _now()
        lobby.setdefault("_hb", {})[username] = _now()
        avatars = lobby.setdefault("_avatars", {})
        if avatar_url and str(avatar_url).strip():
            avatars[username] = str(avatar_url).strip()
        elif username not in avatars:
            avatars[username] = f"https://huggingface.co/avatars/{username}"
        pick = car_id if car_id in CAR_IDS else DEFAULT_CAR
        lobby.setdefault("_cars", {})[username] = pick
        self.by_user[username] = (lobby_id, seat)
        self._note_roster_change(lobby)
        started = self._maybe_start(lobby)
        return {
            "ok": True,
            "lobby": self._public(lobby),
            "seat": seat,
            "started": started,
            "matchId": lobby["match_id"],
            "carId": pick,
        }

    def heartbeat(self, username: str) -> None:
        prev = self.by_user.get(username)
        if not prev:
            return
        lid, _seat = prev
        lobby = self.lobbies.get(lid)
        if not lobby:
            return
        lobby.setdefault("_hb", {})[username] = _now()

    def _tick_stale_and_start(self) -> None:
        now = _now()
        stale_users: list[str] = []
        for username, (lid, _seat) in list(self.by_user.items()):
            lobby = self.lobbies.get(lid)
            if not lobby:
                stale_users.append(username)
                continue
            hb = lobby.get("_hb", {}).get(username, lobby["last_change"])
            status = lobby["status"]
            if status == "open" and now - hb > SEAT_STALE_SEC:
                stale_users.append(username)
            elif status == "live" and now - hb > LIVE_STALE_SEC:
                stale_users.append(username)
            elif status == "starting" and now - lobby["last_change"] > STARTING_TIMEOUT_SEC:
                stale_users.append(username)
        for u in stale_users:
            self._clear_user(u)

        for lobby in list(self.lobbies.values()):
            if lobby["status"] == "starting" and now - lobby["last_change"] > STARTING_TIMEOUT_SEC:
                self._reset_lobby(lobby)
            elif lobby["status"] == "live":
                seated = [u for u in lobby["seats"].values() if u]
                if seated and all(
                    now - lobby.get("_hb", {}).get(u, 0) > LIVE_STALE_SEC for u in seated
                ):
                    self._reset_lobby(lobby)
            elif lobby["status"] == "open":
                self._maybe_start(lobby)

    def _maybe_start(self, lobby: dict[str, Any]) -> bool:
        if lobby["status"] != "open":
            return False
        mode = lobby["mode"]
        seats = lobby["seats"]
        filled = [s for s, u in seats.items() if u]

        if mode == "sandbox":
            if filled:
                return self._mark_starting(lobby)
            return False

        # MVP: ≥2 players in the same seats for MVP_STABLE_SEC without join/leave.
        if mode == "mvp":
            n = len(filled)
            if n < MVP_MIN_PLAYERS:
                lobby["_stable_since"] = None
                return False
            sig = _roster_sig(seats)
            if sig != lobby.get("_roster_sig"):
                lobby["_roster_sig"] = sig
                lobby["_stable_since"] = _now()
                return False
            if lobby.get("_stable_since") is None:
                lobby["_stable_since"] = _now()
                return False
            if (_now() - float(lobby["_stable_since"])) >= MVP_STABLE_SEC:
                return self._mark_starting(lobby)
            return False

        return False

    def _assign_cars(self, lobby: dict[str, Any]) -> None:
        cars = lobby.setdefault("_cars", {})
        if lobby["mode"] == "sandbox":
            for user in lobby["seats"].values():
                if not user:
                    continue
                # Keep menu pick from claim; fall back to default.
                if cars.get(user) not in CAR_IDS:
                    cars[user] = DEFAULT_CAR
            return
        # MVP: honor claimed picks; fill the rest with unique randoms when possible.
        taken = {c for c in cars.values() if c in CAR_IDS}
        pool = [c for c in CAR_IDS if c not in taken]
        random.shuffle(pool)
        i = 0
        for user in lobby["seats"].values():
            if not user:
                continue
            if cars.get(user) in CAR_IDS:
                continue
            if not pool:
                pool = CAR_IDS[:]
                random.shuffle(pool)
                i = 0
            cars[user] = pool[i % len(pool)]
            i += 1

    def _mark_starting(self, lobby: dict[str, Any]) -> bool:
        lobby["status"] = "starting"
        lobby["match_id"] = str(uuid.uuid4())
        lobby["last_change"] = _now()
        lobby["_stable_since"] = None
        self._assign_cars(lobby)
        return True

    def mark_live(self, lobby_id: str) -> None:
        lobby = self.lobbies.get(lobby_id)
        if lobby and lobby["status"] == "starting":
            lobby["status"] = "live"

    def players_in(self, lobby_id: str) -> list[dict[str, str]]:
        lobby = self.lobbies.get(lobby_id)
        if not lobby:
            return []
        avatars = lobby.get("_avatars") or {}
        cars = lobby.get("_cars") or {}
        out = []
        for seat, user in lobby["seats"].items():
            if user:
                car_id = cars.get(user) or (
                    DEFAULT_CAR if lobby["mode"] == "sandbox" else random.choice(CAR_IDS)
                )
                out.append(
                    {
                        "username": user,
                        "seat": seat,
                        "side": "ffa",
                        "carId": car_id,
                        "avatarUrl": avatars.get(user)
                        or f"https://huggingface.co/avatars/{user}",
                    }
                )
        return out

    def get(self, lobby_id: str) -> Optional[dict[str, Any]]:
        return self.lobbies.get(lobby_id)


board = LobbyBoard()
