/**
 * NFS Most Wanted–style tach / speedo / gear HUD.
 * Needle sweeps idle→redline each gear, then drops and climbs again on shift.
 */

const IDLE_RPM = 900;
const REDLINE = 7800;

const SEG = {
  0: 0b0111111,
  1: 0b0000110,
  2: 0b1011011,
  3: 0b1001111,
  4: 0b1100110,
  5: 0b1101101,
  6: 0b1111101,
  7: 0b0000111,
  8: 0b1111111,
  9: 0b1101111,
  R: 0b1010111,
  N: 0b0110111,
  ' ': 0,
};

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawSevenSeg(ctx, x, y, w, h, ch, onColor, offColor) {
  const bits = SEG[ch] ?? 0;
  const t = Math.max(2.5, w * 0.15);
  const gap = 1.5;
  const hw = w - t;
  const hh = (h - t * 2) / 2;

  const segs = [
    [x + t * 0.5 + gap, y, hw - gap * 2, t, 0b0000001],
    [x + w - t, y + t * 0.5 + gap, t, hh - gap * 2, 0b0000010],
    [x + w - t, y + t + hh + gap, t, hh - gap * 2, 0b0000100],
    [x + t * 0.5 + gap, y + h - t, hw - gap * 2, t, 0b0001000],
    [x, y + t + hh + gap, t, hh - gap * 2, 0b0010000],
    [x, y + t * 0.5 + gap, t, hh - gap * 2, 0b0100000],
    [x + t * 0.5 + gap, y + t + hh - t * 0.5, hw - gap * 2, t, 0b1000000],
  ];

  for (const [sx, sy, sw, sh, mask] of segs) {
    ctx.fillStyle = bits & mask ? onColor : offColor;
    roundRect(ctx, sx, sy, sw, sh, Math.min(2, t * 0.35));
    ctx.fill();
  }
}

export class MwSpeedo {
  constructor(parent) {
    this.wrap = document.createElement('div');
    this.wrap.id = 'mw-speedo';
    this.wrap.setAttribute('aria-label', 'speedometer');
    this.canvas = document.createElement('canvas');
    this.canvas.width = 300;
    this.canvas.height = 300;
    this.wrap.appendChild(this.canvas);
    parent.appendChild(this.wrap);
    this.ctx = this.canvas.getContext('2d');
    this._needle = 0;
    this.visible = true;
  }

  setVisible(v) {
    this.visible = v;
    this.wrap.style.display = v ? 'block' : 'none';
  }

  /**
   * @param {{ speedKmh: number, rpm: number, gear: number, reversing?: boolean, throttle?: number }} s
   */
  update(s) {
    if (!this.visible) return;
    const speed = Math.max(0, Math.min(999, Math.round(s.speedKmh || 0)));
    const rpm = s.rpm || IDLE_RPM;
    let gearChar;
    if (s.gear === 0 || s.reversing) gearChar = 'R';
    else if (speed < 2 && !(s.throttle > 0.05)) gearChar = 'N';
    else gearChar = String(Math.min(6, Math.max(1, s.gear | 0)));

    // Per-gear fill: climbs each gear, snaps back toward idle after upshift
    const target = Math.min(1, Math.max(0, (rpm - IDLE_RPM) / (REDLINE - IDLE_RPM)));
    this._needle += (target - this._needle) * 0.32;

    this._draw(speed, gearChar, this._needle);
  }

  _draw(speed, gearChar, needle01) {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const cx = W * 0.5;
    const cy = H * 0.52;
    const R = 124;

    ctx.clearRect(0, 0, W, H);

    // Soft drop shadow disc
    ctx.beginPath();
    ctx.arc(cx + 3, cy + 4, R + 10, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, R + 9, 0, Math.PI * 2);
    ctx.fillStyle = '#050505';
    ctx.fill();

    const face = ctx.createRadialGradient(cx - 20, cy - 30, 8, cx, cy, R);
    face.addColorStop(0, '#22252c');
    face.addColorStop(0.55, '#121418');
    face.addColorStop(1, '#07080a');
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = face;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.stroke();

    // 8 o'clock → 4 o'clock clockwise through the top (~240°)
    const a0 = (150 * Math.PI) / 180;
    const sweep = (240 * Math.PI) / 180;

    // Redline band
    ctx.beginPath();
    ctx.arc(cx, cy, R - 12, a0 + sweep * 0.78, a0 + sweep, false);
    ctx.strokeStyle = '#d01010';
    ctx.lineWidth = 11;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const ang = a0 + sweep * t;
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      ctx.beginPath();
      ctx.moveTo(cx + cos * (R - 20), cy + sin * (R - 20));
      ctx.lineTo(cx + cos * (R - 7), cy + sin * (R - 7));
      ctx.strokeStyle = i >= 8 ? '#ff2a2a' : '#ececec';
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.fillStyle = i >= 8 ? '#ff3a3a' : '#f2f2f2';
      ctx.font = 'bold 16px Arial, Helvetica, sans-serif';
      ctx.fillText(String(i), cx + cos * (R - 38), cy + sin * (R - 38));
    }

    // Gear — small 7-seg above center
    drawSevenSeg(ctx, cx - 16, cy - 62, 32, 48, gearChar, '#f6f6f6', 'rgba(255,255,255,0.055)');

    // Speed — 3 digit LCD with ghost 888
    const display = String(speed).padStart(3, '0');
    const dW = 28;
    const dH = 44;
    const gap = 7;
    const totalW = dW * 3 + gap * 2;
    const dx0 = cx - totalW / 2;
    const dy = cy + 26;
    for (let i = 0; i < 3; i++) {
      drawSevenSeg(
        ctx,
        dx0 + i * (dW + gap),
        dy,
        dW,
        dH,
        display[i],
        '#ffffff',
        'rgba(255,255,255,0.07)',
      );
    }
    ctx.fillStyle = 'rgba(230,230,230,0.9)';
    ctx.font = 'bold 12px Arial, Helvetica, sans-serif';
    ctx.fillText('KM/H', cx, dy + dH + 13);

    // Hub + needle
    ctx.beginPath();
    ctx.arc(cx, cy, 14, 0, Math.PI * 2);
    ctx.fillStyle = '#2e2e34';
    ctx.fill();
    ctx.strokeStyle = '#777';
    ctx.lineWidth = 2;
    ctx.stroke();

    const nang = a0 + sweep * needle01;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(nang);
    ctx.beginPath();
    ctx.moveTo(-8, 0);
    ctx.lineTo(0, -5);
    ctx.lineTo(R - 30, 0);
    ctx.lineTo(0, 5);
    ctx.closePath();
    const ng = ctx.createLinearGradient(0, 0, R - 30, 0);
    ng.addColorStop(0, '#ffb020');
    ng.addColorStop(0.45, '#ff8c00');
    ng.addColorStop(1, '#ffd060');
    ctx.fillStyle = ng;
    ctx.shadowColor = 'rgba(255,140,0,0.55)';
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#d0d0d0';
    ctx.fill();
  }
}
