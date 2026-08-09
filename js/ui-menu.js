/** Start screen + lobby browser (DOM). */

import {
  CAR_IDS,
  CAR_LABELS,
  CAR_THUMBS,
  DEFAULT_CAR,
  isValidCarId,
} from './cars.js';

export class GameMenu {
  constructor({
    root,
    onOpenMode,
    onBack,
    onClaim,
    onLeaveSeat,
    onEnterMatch,
    onSpectate,
  }) {
    this.root = root;
    this.onOpenMode = onOpenMode;
    this.onBack = onBack;
    this.onClaim = onClaim;
    this.onLeaveSeat = onLeaveSeat;
    this.onEnterMatch = onEnterMatch;
    this.onSpectate = onSpectate;
    this.screen = 'start'; // start | lobby
    this.mode = null;
    this.username = null;
    this.spaceUrl = null;
    this.authError = null;
    this.playAllowed = true;
    this.selectedLobby = null;
    let saved = DEFAULT_CAR;
    try {
      saved = localStorage.getItem('hf_racing_car') || DEFAULT_CAR;
    } catch (_) {
      /* ignore */
    }
    this.selectedCarId = isValidCarId(saved) ? saved : DEFAULT_CAR;

    this.els = {
      start: root.querySelector('#menu-start'),
      lobby: root.querySelector('#menu-lobby'),
      lobbyTitle: root.querySelector('#lobby-title'),
      lobbyList: root.querySelector('#lobby-list'),
      lobbyMeta: root.querySelector('#lobby-meta'),
      userLabel: root.querySelector('#menu-user'),
      err: root.querySelector('#menu-error'),
      btnBack: root.querySelector('#btn-lobby-back'),
      btnEnter: root.querySelector('#btn-lobby-enter'),
      btnLeave: root.querySelector('#btn-lobby-leave'),
      carBtn: root.querySelector('#car-select-btn'),
      carList: root.querySelector('#car-select-list'),
      carThumb: root.querySelector('#car-select-thumb'),
      carName: root.querySelector('#car-select-name'),
      carPicker: root.querySelector('#car-picker'),
    };

    this._initCarPicker();

    root.querySelector('#btn-mode-sandbox')?.addEventListener('click', () => this._pickMode('sandbox'));
    root.querySelector('#btn-mode-mvp')?.addEventListener('click', () => this._pickMode('mvp'));
    this.els.btnBack?.addEventListener('click', () => {
      this.showStart();
      this.onBack?.();
    });
    this.els.btnEnter?.addEventListener('click', () => this.onEnterMatch?.());
    this.els.btnLeave?.addEventListener('click', () => this.onLeaveSeat?.());
  }

  getSelectedCar() {
    return isValidCarId(this.selectedCarId) ? this.selectedCarId : DEFAULT_CAR;
  }

  _initCarPicker() {
    const list = this.els.carList;
    const btn = this.els.carBtn;
    if (!list || !btn) return;

    list.innerHTML = '';
    for (const id of CAR_IDS) {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = 'car-option';
      opt.dataset.carId = id;
      opt.innerHTML = `<img class="car-thumb" src="${CAR_THUMBS[id]}" alt="" width="64" height="36" /><span>${CAR_LABELS[id] || id}</span>`;
      opt.addEventListener('click', () => {
        this._setCar(id);
        this._closeCarList();
      });
      li.appendChild(opt);
      list.appendChild(li);
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = btn.getAttribute('aria-expanded') === 'true';
      if (open) this._closeCarList();
      else this._openCarList();
    });

    document.addEventListener('click', (e) => {
      if (!this.els.carPicker?.contains(e.target)) this._closeCarList();
    });

    this._setCar(this.selectedCarId);
  }

  _setCar(id) {
    if (!isValidCarId(id)) id = DEFAULT_CAR;
    this.selectedCarId = id;
    try {
      localStorage.setItem('hf_racing_car', id);
    } catch (_) {
      /* ignore */
    }
    if (this.els.carThumb) {
      this.els.carThumb.src = CAR_THUMBS[id];
      this.els.carThumb.alt = CAR_LABELS[id] || id;
    }
    if (this.els.carName) this.els.carName.textContent = CAR_LABELS[id] || id;
    this.els.carList?.querySelectorAll('.car-option').forEach((el) => {
      el.setAttribute('aria-selected', el.dataset.carId === id ? 'true' : 'false');
    });
  }

  _openCarList() {
    if (!this.els.carList || !this.els.carBtn) return;
    this.els.carList.hidden = false;
    this.els.carBtn.setAttribute('aria-expanded', 'true');
  }

  _closeCarList() {
    if (!this.els.carList || !this.els.carBtn) return;
    this.els.carList.hidden = true;
    this.els.carBtn.setAttribute('aria-expanded', 'false');
  }

  setIdentity({ username, spaceUrl, authError, playAllowed = true }) {
    this.username = username;
    this.spaceUrl = spaceUrl;
    this.authError = authError;
    this.playAllowed = playAllowed !== false;
    if (this.els.userLabel) {
      if (!username) {
        this.els.userLabel.textContent = authError || 'Not signed in — set HF_TOKEN in .env.local';
      } else if (!this.playAllowed) {
        this.els.userLabel.textContent = `Spectator · ${username}`;
      } else if (String(username).startsWith('guest-')) {
        this.els.userLabel.textContent = `Guest · ${username}`;
      } else {
        this.els.userLabel.textContent = `Signed in as ${username}`;
      }
    }
    if (this.els.btnEnter) this.els.btnEnter.hidden = !this.playAllowed;
    if (this.els.btnLeave) this.els.btnLeave.hidden = !this.playAllowed;
    const sub = this.root.querySelector('.menu-sub');
    if (sub) {
      sub.textContent = this.playAllowed
        ? 'Sandbox · MVP'
        : 'Spectate only — no HF login · play is local-only';
    }
    for (const id of ['btn-mode-sandbox', 'btn-mode-mvp']) {
      const btn = this.root.querySelector(`#${id}`);
      if (btn) btn.hidden = !this.playAllowed;
    }
    if (this.els.carPicker) this.els.carPicker.hidden = !this.playAllowed;
    if (!this.playAllowed && this.els.start) {
      this.showLobby('mvp');
      this.onOpenMode?.('mvp');
    }
  }

  show() {
    this.root.hidden = false;
    this.root.classList.add('menu-open');
    this.showStart();
  }

  hide() {
    this.root.hidden = true;
    this.root.classList.remove('menu-open');
  }

  showStart() {
    this.screen = 'start';
    this.mode = null;
    this.selectedLobby = null;
    if (this.els.start) this.els.start.hidden = false;
    if (this.els.lobby) this.els.lobby.hidden = true;
    if (this.els.lobbyList) this.els.lobbyList.innerHTML = '';
    if (this.els.lobbyMeta) this.els.lobbyMeta.textContent = '';
    if (this.els.lobbyTitle) this.els.lobbyTitle.textContent = 'Lobbies';
    this._setError('');
  }

  showLobby(mode) {
    this.screen = 'lobby';
    this.mode = mode;
    if (this.els.start) this.els.start.hidden = true;
    if (this.els.lobby) this.els.lobby.hidden = false;
    if (this.els.lobbyTitle) {
      const titles = { sandbox: 'Sandbox lobbies', mvp: 'MVP lobbies' };
      this.els.lobbyTitle.textContent = titles[mode] || mode;
    }
  }

  _pickMode(mode) {
    if (!this.username) {
      this._setError(this.authError || 'Set HF_TOKEN in .env.local');
      return;
    }
    this._setError('');
    this.showLobby(mode);
    this.onOpenMode?.(mode);
  }

  _setError(msg) {
    if (this.els.err) {
      this.els.err.textContent = msg || '';
      this.els.err.hidden = !msg;
    }
  }

  _seatLabel(seatKey) {
    const m = String(seatKey).match(/^([SP])-(\d+)$/i);
    if (!m) return { team: null, label: seatKey, cls: '' };
    return { team: null, label: m[2], cls: '' };
  }

  _makeSeatBtn(mode, lobby, seat, user) {
    const meta = this._seatLabel(seat);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `seat-btn ${meta.cls}${user ? ' filled' : ''}`.trim();
    const locked =
      !this.playAllowed ||
      !!user ||
      lobby.status === 'live' ||
      lobby.status === 'starting';
    btn.disabled = locked;
    btn.title = locked
      ? (lobby.status === 'live' || lobby.status === 'starting'
        ? `${lobby.id} is ${lobby.status} — pick another lobby or wait`
        : (user ? `${user} is seated` : 'Spectate only'))
      : seat;
    btn.innerHTML = user
      ? `${meta.label}<span class="seat-who">${user}</span>`
      : meta.label;
    if (this.playAllowed) {
      btn.addEventListener('click', async () => {
        if (btn.disabled) return;
        try {
          this._setError('');
          btn.disabled = true;
          btn.textContent = '…';
          await this.onClaim?.(mode, lobby.id, seat);
          this.selectedLobby = lobby.id;
        } catch (err) {
          this._setError(err.message || String(err));
        }
      });
    }
    return btn;
  }

  renderBoard(board, mode, error = null) {
    const list = this.els.lobbyList;
    if (!list) return;
    if (error || !board) {
      list.innerHTML = `<div class="lobby-card"><strong>Waiting for game server…</strong>
        <div class="lobby-seats" style="display:block;margin-top:0.4rem">
        ${error || 'Lobby server not reachable.'}
        </div></div>`;
      this._setError(error || 'Lobby server not ready');
      return;
    }
    this._setError('');
    const key = mode === 'mvp' ? 'mvp' : 'sandbox';
    const lobbies = board[key] || [];
    list.innerHTML = '';

    for (const lobby of lobbies) {
      const card = document.createElement('div');
      card.className = 'lobby-card';
      card.dataset.id = lobby.id;

      const head = document.createElement('div');
      head.className = 'lobby-card-head';
      const cd = lobby.countdown != null ? ` · ${Math.ceil(lobby.countdown)}s` : '';
      head.innerHTML = `<strong>${lobby.id}</strong><span>${lobby.filled}/${lobby.capacity} · ${lobby.status}${cd}</span>`;
      card.appendChild(head);

      const seats = document.createElement('div');
      seats.className = 'lobby-seats';
      for (const [seat, user] of Object.entries(lobby.seats || {})) {
        seats.appendChild(this._makeSeatBtn(mode, lobby, seat, user));
      }
      if (lobby.status === 'live' || lobby.status === 'starting') {
        const spec = document.createElement('button');
        spec.type = 'button';
        spec.className = 'seat-btn spectate-btn';
        spec.textContent = 'Spectate';
        spec.addEventListener('click', async () => {
          try {
            this._setError('');
            this.selectedLobby = lobby.id;
            await this.onSpectate?.(mode, lobby.id);
          } catch (err) {
            this._setError(err.message || String(err));
          }
        });
        seats.appendChild(spec);
      }
      card.appendChild(seats);
      list.appendChild(card);
    }

    if (this.els.lobbyMeta) {
      if (!this.playAllowed) {
        this.els.lobbyMeta.textContent =
          'Spectate only — click Spectate on a live lobby. No HF login required.';
      } else if (mode === 'mvp') {
        this.els.lobbyMeta.textContent =
          `MVP: needs ≥2 players. Starts after 30s with the same seats filled — join/leave resets the timer. Your car: ${CAR_LABELS[this.getSelectedCar()] || this.getSelectedCar()}.`;
      } else {
        this.els.lobbyMeta.textContent =
          `Sandbox: click an open seat — race starts immediately. Car: ${CAR_LABELS[this.getSelectedCar()] || this.getSelectedCar()}.`;
      }
    }
  }
}
