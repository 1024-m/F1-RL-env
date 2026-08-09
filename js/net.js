/** Lobby + match WebSocket client (racing state sync). */

import { PeerManager } from './peers.js';

const STATE_HZ = 30;
const STATE_INTERVAL = 1 / STATE_HZ;
const LOBBY_POLL_MS = 1000;
const HEARTBEAT_MS = 3000;

function wsUrl(spaceUrl, mode, lobbyId, username, role = 'play') {
  // Always same-origin for the local game client. Remote Space WS dies during
  // the ~90MB map download and was kicking players back to the lobby.
  const base = window.location.origin.replace(/\/$/, '');
  const u = new URL(base);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = `/ws/match/${encodeURIComponent(mode)}/${encodeURIComponent(lobbyId)}`;
  u.search = `user=${encodeURIComponent(username)}&role=${encodeURIComponent(role)}`;
  return u.toString();
}

export class NetClient {
  constructor({ scene, onStatus, onMatchStart, onMatchEnd, onLobbyUpdate, onMatchConnectionLost }) {
    this.scene = scene;
    this.onStatus = onStatus || (() => {});
    this.onMatchStart = onMatchStart || (() => {});
    this.onMatchEnd = onMatchEnd || (() => {});
    this.onLobbyUpdate = onLobbyUpdate || (() => {});
    this.onMatchConnectionLost = onMatchConnectionLost || (() => {});

    this.username = null;
    this.avatarUrl = null;
    this.spaceUrl = null;
    this.playAllowed = true;
    this.host = 'local';
    this.mode = null;
    this.lobbyId = null;
    this.seat = null;
    this.side = null;
    this.matchId = null;
    this.inMatch = false;
    this.ws = null;
    this.peers = new PeerManager(scene);
    this.board = null;
    this._pollTimer = null;
    this._hbTimer = null;
    this._stateAcc = 0;
    this._spawnIndex = 0;
    this.players = [];
    this.spectating = false;
    this.carId = null;
  }

  async initLocal() {
    const cfg = await fetch('/api/config').then((r) => r.json());
    this.spaceUrl = cfg.spaceUrl || '';
    this.username = cfg.username || null;
    this.host = cfg.host || 'local';
    this.playAllowed = cfg.host === 'space' ? false : cfg.playAllowed !== false;
    this.avatarUrl = cfg.avatarUrl || (this.username && !String(this.username).startsWith('guest-')
      ? `https://huggingface.co/avatars/${encodeURIComponent(this.username)}`
      : null);
    if (!this.username) {
      return { ok: false, error: cfg.authError || 'No player identity' };
    }
    if (this.host === 'local' && String(this.username).startsWith('guest-')) {
      return { ok: false, error: 'Local play requires HF_TOKEN (guest ids are spectate-only on Space)' };
    }
    if (this.playAllowed && cfg.hasToken === false && this.host !== 'space') {
      return { ok: false, error: cfg.authError || 'Set HF_TOKEN in .env.local' };
    }
    return {
      ok: true,
      username: this.username,
      avatarUrl: this.avatarUrl,
      spaceUrl: this.spaceUrl || window.location.origin,
      playAllowed: this.playAllowed,
      host: this.host,
    };
  }

  _lobbyBase() {
    return '';
  }

  async _fetchLobbies() {
    const res = await fetch(`${this._lobbyBase()}/api/lobbies`);
    if (!res.ok) throw new Error(`Lobby server ${res.status}`);
    const board = await res.json();
    if (!board?.mvp && !board?.sandbox) throw new Error('Bad lobby payload');
    return board;
  }

  startLobbyPoll(mode) {
    this.mode = mode;
    this.stopLobbyPoll();
    const tick = async () => {
      try {
        const board = await this._fetchLobbies();
        this.board = board;
        this.onLobbyUpdate(board, mode, null);
      } catch (err) {
        this.onStatus(`Lobby poll failed: ${err.message}`);
        this.onLobbyUpdate(null, mode, err.message || String(err));
      }
    };
    tick();
    this._pollTimer = setInterval(tick, LOBBY_POLL_MS);
    this._hbTimer = setInterval(() => {
      if (!this.username) return;
      fetch(`${this._lobbyBase()}/api/lobbies/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: this.username }),
      }).catch(() => {});
    }, HEARTBEAT_MS);
  }

  stopLobbyPoll() {
    if (this._pollTimer) clearInterval(this._pollTimer);
    if (this._hbTimer) clearInterval(this._hbTimer);
    this._pollTimer = null;
    this._hbTimer = null;
  }

  async claim(mode, lobbyId, seat, carId = null) {
    if (!this.playAllowed) throw new Error('Play disabled here — spectate only');
    const res = await fetch(`/api/lobbies/${encodeURIComponent(mode)}/${encodeURIComponent(lobbyId)}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: this.username,
        seat,
        avatarUrl: this.avatarUrl || null,
        carId: carId || null,
      }),
    });
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(`claim failed (${res.status})`);
    }
    if (!res.ok || !data.ok) throw new Error(data.error || `claim failed (${res.status})`);
    this.mode = mode;
    this.lobbyId = lobbyId;
    this.seat = seat;
    this.side = seatSide(seat);
    this.matchId = data.matchId || null;
    return data;
  }

  async leaveLobby() {
    this.disconnectMatch();
    if (!this.username) return;
    await fetch(`${this._lobbyBase()}/api/lobbies/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: this.username }),
    }).catch(() => {});
    this.lobbyId = null;
    this.seat = null;
  }

  connectMatch() {
    if (!this.playAllowed || this.host === 'space') {
      this.onStatus('Play disabled here — spectate only');
      return;
    }
    if (!this.lobbyId || !this.mode) return;
    this._openMatchWs('play');
  }

  connectSpectate(mode, lobbyId) {
    if (!mode || !lobbyId || !this.username) return;
    this.mode = mode;
    this.lobbyId = lobbyId;
    this.seat = null;
    this.side = 'ffa';
    this.spectating = true;
    this._openMatchWs('spectate');
  }

  _openMatchWs(role) {
    if (this.host === 'space' || !this.playAllowed) role = 'spectate';
    this.disconnectMatch(false);
    this.spectating = role === 'spectate';
    const url = wsUrl(this.spaceUrl, this.mode, this.lobbyId, this.username, role);
    this.onStatus(this.spectating ? 'Connecting as spectator…' : 'Connecting to race…');
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.onStatus(this.spectating ? 'Waiting for race (spectate)…' : 'Waiting for race start…');
      this.send({ type: 'ready', username: this.username });
    };

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      this._onMessage(msg);
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      const wasInMatch = this.inMatch;
      const wasSpectating = this.spectating;
      this.ws = null;
      this.inMatch = false;
      this.onStatus('Match connection closed');
      if (wasInMatch || wasSpectating) {
        this.onMatchConnectionLost({ wasInMatch, wasSpectating });
      }
    };

    ws.onerror = () => {
      this.onStatus('Match WebSocket error');
    };
  }

  disconnectMatch(clearPeers = true) {
    const ws = this.ws;
    this.ws = null;
    this.inMatch = false;
    this.matchId = null;
    this.spectating = false;
    if (ws) {
      try {
        ws.close();
      } catch {
        // ignore
      }
    }
    if (clearPeers) this.peers.clear();
  }

  send(msg) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.spectating && msg?.type && msg.type !== 'ping' && msg.type !== 'ready') return;
    this.ws.send(JSON.stringify(msg));
  }

  _onMessage(msg) {
    const type = msg.type;
    if (type === 'waiting') {
      this.onStatus('In lobby — waiting for race start…');
      return;
    }
    if (type === 'error') {
      this.onStatus(msg.error || 'Server error');
      if (/seat|seated|rejoin|lobby reset|match did not start/i.test(msg.error || '')) {
        try {
          this.ws?.close();
        } catch {
          // ignore
        }
      }
      return;
    }
    if (type === 'match_start') {
      this.inMatch = true;
      this.matchId = msg.matchId;
      this.players = msg.players || [];
      this.spectating =
        !!msg.spectating || this.spectating || !this.playAllowed || this.host === 'space';
      this.seat = this.spectating ? null : (msg.seat || this.seat);
      this.side = this.spectating ? 'ffa' : seatSide(this.seat);
      const me = (this.players || []).find((p) => p.username === this.username);
      this.carId = this.spectating ? null : (me?.carId || null);
      const hideSelf = this.spectating ? null : this.username;
      this.peers.syncPlayers(this.players, hideSelf);
      this._spawnIndex = this.spectating ? 0 : spawnIndexFor(this.seat, this.mode, this.players);
      this.onMatchStart({
        mode: msg.mode || this.mode,
        seat: this.seat,
        side: this.side,
        players: this.players,
        spawnIndex: this._spawnIndex,
        spectating: this.spectating,
        carId: this.carId,
      });
      // Do not clobber enterRace status (car/map load messages).
      return;
    }
    if (type === 'player_joined' || type === 'player_left') {
      this.players = msg.players || this.players;
      this.peers.syncPlayers(this.players, this.spectating ? null : this.username);
      return;
    }
    if (type === 'state' && msg.from) {
      this.peers.applyState(msg.from, msg);
      return;
    }
    if (type === 'match_end') {
      this.onMatchEnd(msg);
      this.onStatus(`Race over — ${msg.winner || 'finish'}`);
    }
  }

  /** Call each frame while in a race */
  update(delta, car) {
    if (!this.inMatch) return;
    this.peers.update(delta);
    if (this.spectating || !car) return;

    this._stateAcc += delta;
    if (this._stateAcc >= STATE_INTERVAL) {
      this._stateAcc = 0;
      const p = car.position;
      this.send({
        type: 'state',
        pos: [p.x, p.y, p.z],
        rot: [car.yaw, 0, 0],
        speed: car.speed || 0,
        avatarUrl: this.avatarUrl || undefined,
      });
    }
  }
}

function seatSide(seat) {
  if (!seat) return 'ffa';
  const s = String(seat);
  if (s.startsWith('X-')) return 'X';
  if (s.startsWith('Y-')) return 'Y';
  return 'ffa';
}

export function spawnIndexFor(seat, mode, players) {
  if (mode === 'mvp') {
    const m = String(seat).match(/^P-(\d+)$/i);
    if (m) return Math.max(0, Math.min(7, Number(m[1]) - 1));
  }
  // sandbox / fallback: index among seated players
  const names = (players || []).map((p) => p.username).sort();
  const me = (players || []).find((p) => p.seat === seat)?.username;
  const idx = Math.max(0, names.indexOf(me));
  return idx % 8;
}

/** Grid offsets until real track start line exists */
export const SPAWN_OFFSETS = [
  { x: -6, z: 0 },
  { x: -2, z: 0 },
  { x: 2, z: 0 },
  { x: 6, z: 0 },
  { x: -6, z: -6 },
  { x: -2, z: -6 },
  { x: 2, z: -6 },
  { x: 6, z: -6 },
];
