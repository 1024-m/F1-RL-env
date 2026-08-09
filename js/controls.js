/** Keyboard driving input (WASD / arrows). Active only while racing. */

const DRIVE_CODES = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'ShiftLeft', 'ShiftRight',
]);

export class DriveControls {
  constructor() {
    this.keys = new Set();
    this.enabled = false;
    this._down = (e) => {
      if (!this.enabled) return;
      if (!DRIVE_CODES.has(e.code)) return;
      e.preventDefault();
      this.keys.add(e.code);
    };
    this._up = (e) => {
      if (!DRIVE_CODES.has(e.code)) return;
      if (this.enabled) e.preventDefault();
      this.keys.delete(e.code);
    };
    this._blur = () => this.keys.clear();
    window.addEventListener('keydown', this._down, { capture: true });
    window.addEventListener('keyup', this._up, { capture: true });
    window.addEventListener('blur', this._blur);
  }

  enable() {
    this.enabled = true;
  }

  disable() {
    this.enabled = false;
    this.keys.clear();
  }

  dispose() {
    this.disable();
    window.removeEventListener('keydown', this._down, { capture: true });
    window.removeEventListener('keyup', this._up, { capture: true });
    window.removeEventListener('blur', this._blur);
  }

  sample() {
    if (!this.enabled) return { throttle: 0, steer: 0, brake: 0, reverse: 0 };
    const forward = this.keys.has('KeyW') || this.keys.has('ArrowUp');
    const back = this.keys.has('KeyS') || this.keys.has('ArrowDown');
    const left = this.keys.has('KeyA') || this.keys.has('ArrowLeft');
    const right = this.keys.has('KeyD') || this.keys.has('ArrowRight');
    // S / ↓ same full brake as Space / Shift (not weak engine-brake).
    const brake =
      back ||
      this.keys.has('Space') ||
      this.keys.has('ShiftLeft') ||
      this.keys.has('ShiftRight');
    return {
      throttle: forward ? 1 : 0,
      steer: (left ? 1 : 0) - (right ? 1 : 0),
      brake: brake ? 1 : 0,
      // Reverse only from S/↓ once almost stopped (Space/Shift stay brake-only).
      reverse: back && !forward ? 1 : 0,
    };
  }
}
