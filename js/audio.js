/** Procedural engine / brake / impact audio (Web Audio). */

export class RaceAudio {
  constructor() {
    this.ctx = null;
    this.engine = null;
    this.engineGain = null;
    this.brakeGain = null;
    this.enabled = false;
  }

  async ensure() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    this.engine = this.ctx.createOscillator();
    this.engine.type = 'sawtooth';
    this.engine.frequency.value = 60;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engine.connect(filter);
    filter.connect(this.engineGain);
    this.engineGain.connect(this.ctx.destination);
    this.engine.start();

    // Brake hiss (noise)
    const bufferSize = 2 * this.ctx.sampleRate;
    const noiseBuf = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = this.ctx.createBufferSource();
    noise.buffer = noiseBuf;
    noise.loop = true;
    const nFilter = this.ctx.createBiquadFilter();
    nFilter.type = 'bandpass';
    nFilter.frequency.value = 1200;
    this.brakeGain = this.ctx.createGain();
    this.brakeGain.gain.value = 0;
    noise.connect(nFilter);
    nFilter.connect(this.brakeGain);
    this.brakeGain.connect(this.ctx.destination);
    noise.start();

    this.enabled = true;
  }

  update({ speedMps, throttle, brake, rpm, colliding }) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const spd = Math.abs(speedMps);
    const eng = 55 + (rpm || spd * 40) + Math.abs(throttle) * 80;
    this.engine.frequency.setTargetAtTime(eng, t, 0.05);
    const vol = 0.02 + Math.min(0.22, spd * 0.004 + Math.abs(throttle) * 0.12);
    this.engineGain.gain.setTargetAtTime(vol, t, 0.08);
    this.brakeGain.gain.setTargetAtTime(brake > 0.2 && spd > 2 ? 0.06 * brake : 0, t, 0.05);
    if (colliding) {
      this.impact();
    }
  }

  impact() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = 90;
    g.gain.value = 0.15;
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g);
    g.connect(this.ctx.destination);
    o.start(t);
    o.stop(t + 0.2);
  }

  stop() {
    if (!this.engineGain) return;
    const t = this.ctx.currentTime;
    this.engineGain.gain.setTargetAtTime(0, t, 0.05);
    this.brakeGain.gain.setTargetAtTime(0, t, 0.05);
  }
}
