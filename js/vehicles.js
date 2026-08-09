/**
 * Local car: GLB model + longitudinal/lateral grip + airtime.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DEFAULT_CAR } from './cars.js';

/** 6-speed auto — mph-ish tops per gear; power is RPM-shaped, not linear. */
const GEARS = [
  { ratio: 3.9, max: 13 },  // ~47 km/h
  { ratio: 2.7, max: 22 },  // ~79
  { ratio: 1.95, max: 34 }, // ~122
  { ratio: 1.45, max: 48 }, // ~173
  { ratio: 1.12, max: 64 }, // ~230
  { ratio: 0.88, max: 86 }, // ~310
];
const IDLE_RPM = 900;
const REDLINE = 7800;
const SHIFT_UP_RPM = 7100;
const SHIFT_DOWN_RPM = 2600;
const SHIFT_TIME = 0.16;
const FINAL_DRIVE = 3.2;

const GRAVITY = 26;

function torqueAtRpm(rpm) {
  const n = THREE.MathUtils.clamp(rpm / REDLINE, 0, 1.05);
  // Strong launch / clutch slip below ~2.5k, peak midband, soft cut near redline.
  if (n < 0.32) return 0.72 + n * 0.9;
  const mid = Math.sin(Math.min(1, n) * Math.PI);
  const highCut = n > 0.92 ? Math.max(0.35, 1 - (n - 0.92) * 5) : 1;
  return Math.max(0.4, mid * 1.15 * highCut);
}
const FALLBACK_CARS = [
  'mclaren_600lt',
  'ford_gt',
  'corvette_zr1',
  'lambo_sc18',
  'porsche_gt2rs',
  'mustang_roush',
];

let _haloTex = null;
function softHaloTexture() {
  if (_haloTex) return _haloTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.65)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0.18)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  _haloTex = new THREE.CanvasTexture(c);
  _haloTex.colorSpace = THREE.SRGBColorSpace;
  return _haloTex;
}

let _anchorsPromise = null;
function loadAnchors() {
  if (!_anchorsPromise) {
    _anchorsPromise = fetch('js/car-anchors.json')
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));
  }
  return _anchorsPromise;
}

export class LocalCar {
  constructor(scene) {
    this.scene = scene;
    this.speed = 0;
    this.vx = 0;
    this.vz = 0;
    this.vy = 0;
    this.yaw = 0;
    this.gear = 1;
    this.rpm = IDLE_RPM;
    this.throttle = 0;
    this.brake = 0;
    this.steering = 0;
    this.reversing = false;
    this.braking = false;
    this.colliding = false;
    this.offRoad = false;
    this.airborne = false;
    this._brakeHold = 0;
    this._shiftTimer = 0;
    this._shiftDir = 0;
    this.loaded = false;

    this.root = new THREE.Group();
    this.mesh = this.root;
    this.position = this.root.position;
    scene.add(this.root);

    this.modelId = null;
    this._model = null;
    this._size = new THREE.Vector3(1.9, 1.2, 4.5);
    this.brakeLights = [];
    this.reverseLights = [];
    this.exhausts = [];
    this._reverseBlink = 0;
    this._emissiveMats = [];
    this._headlightMats = [];
    this._brakeGlow = [];
    this._brakeHalos = [];
    this._headGlow = [];
    this._headHalos = [];
    this._reverseGlow = [];
    this.lastError = null;
  }

  async loadModel(preferredId = DEFAULT_CAR) {
    const tryIds = [preferredId, ...FALLBACK_CARS.filter((id) => id !== preferredId)];
    const errors = [];
    for (const id of tryIds) {
      try {
        await this._loadOne(id);
        this.loaded = true;
        this.lastError = null;
        return id;
      } catch (err) {
        const msg = err?.message || String(err);
        console.warn('car load failed', id, err);
        errors.push(`${id}: ${msg}`);
        this.lastError = errors.join(' | ');
      }
    }
    throw new Error(this.lastError || 'all cars failed');
  }

  async _loadOne(id) {
    const url = `assets/cars/${id}.glb`;
    const loader = new GLTFLoader();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 1000) throw new Error(`tiny glb ${buf.byteLength}`);
    const gltf = await loader.parseAsync(buf, 'assets/cars/');

    const model = gltf.scene;
    if (!model) throw new Error('no scene in glb');

    model.updateMatrixWorld(true);
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = true;
    });

    const TARGET_LEN = 4.6;
    let box = new THREE.Box3().setFromObject(model);
    if (box.isEmpty()) throw new Error('empty bounds');
    let size = box.getSize(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z, 1e-6);
    model.scale.setScalar(TARGET_LEN / longest);
    model.updateMatrixWorld(true);

    box = new THREE.Box3().setFromObject(model);
    size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    if (!(size.x > 0.5 && size.z > 1.0)) {
      throw new Error(`bad size after normalize ${size.x.toFixed(2)},${size.y.toFixed(2)},${size.z.toFixed(2)}`);
    }

    model.position.sub(center);
    model.position.y += size.y / 2;
    this._size.copy(size);

    if (this._model) {
      this.root.remove(this._model);
      this._model = null;
    }
    this._model = model;
    this.root.add(model);
    this.modelId = id;

    const anchors = await loadAnchors();
    this._hookEmissiveLights(model);
    this._hookHeadlights(model);
    this._buildFxAnchors(anchors[id] || null);
  }

  _buildFxAnchors(spec) {
    for (const o of [...this.brakeLights, ...this.reverseLights]) this.root.remove(o);
    for (const { light, flame } of this.exhausts) {
      this.root.remove(light);
      this.root.remove(flame);
    }
    for (const l of this._brakeGlow) this.root.remove(l);
    for (const l of this._reverseGlow) this.root.remove(l);
    for (const l of this._headGlow) this.root.remove(l);
    for (const h of this._brakeHalos) this.root.remove(h);
    for (const h of this._headHalos) this.root.remove(h);
    this.brakeLights = [];
    this.reverseLights = [];
    this.exhausts = [];
    this._brakeGlow = [];
    this._reverseGlow = [];
    this._headGlow = [];
    this._brakeHalos = [];
    this._headHalos = [];

    // Real GLB taillights only — no fake LED box boards.
    const brakes = spec?.brakeLights || [
      { x: -this._size.x * 0.28, y: this._size.y * 0.42, z: -this._size.z * 0.48 },
      { x: this._size.x * 0.28, y: this._size.y * 0.42, z: -this._size.z * 0.48 },
    ];
    const reverses = spec?.reverseLights || brakes.map((p) => ({
      x: p.x * 0.55,
      y: p.y - 0.06,
      z: p.z - 0.02,
    }));
    const heads = spec?.headlights || [
      { x: -this._size.x * 0.28, y: this._size.y * 0.4, z: this._size.z * 0.48 },
      { x: this._size.x * 0.28, y: this._size.y * 0.4, z: this._size.z * 0.48 },
    ];
    const exhausts = spec?.exhausts || [
      { x: -0.22, y: this._size.y * 0.2, z: -this._size.z * 0.49 },
      { x: 0.22, y: this._size.y * 0.2, z: -this._size.z * 0.49 },
    ];

    const haloTex = softHaloTexture();
    for (const p of brakes) {
      const glow = new THREE.PointLight(0xff1010, 0, 8, 1.6);
      glow.position.set(p.x, p.y, p.z);
      this.root.add(glow);
      this._brakeGlow.push(glow);

      // Soft red bloom halo (local) — same look as before without making snow glow.
      const halo = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: haloTex,
          color: 0xff2200,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      halo.position.set(p.x, p.y, p.z - 0.15);
      halo.scale.set(2.8, 2.8, 1);
      this.root.add(halo);
      this._brakeHalos.push(halo);
    }
    // Front white headlights — always on at night (visual + short local fill).
    for (const p of heads) {
      const glow = new THREE.PointLight(0xf4f7ff, 2.2, 6.5, 2.0);
      glow.position.set(p.x, p.y, p.z + 0.05);
      this.root.add(glow);
      this._headGlow.push(glow);

      const halo = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: haloTex,
          color: 0xeef3ff,
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
          fog: false,
        }),
      );
      halo.position.set(p.x, p.y, p.z + 0.12);
      halo.scale.set(2.2, 2.2, 1);
      this.root.add(halo);
      this._headHalos.push(halo);
    }
    for (const p of reverses) {
      const glow = new THREE.PointLight(0xfff5e0, 0, 5, 1.8);
      glow.position.set(p.x, p.y, p.z);
      this.root.add(glow);
      this._reverseGlow.push(glow);
    }
    for (const p of exhausts) {
      const light = new THREE.PointLight(0xff3300, 0, 5, 2);
      light.position.set(p.x, p.y, p.z);
      this.root.add(light);
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.07, 0.4, 8, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xff6600,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      flame.rotation.x = Math.PI / 2;
      flame.position.set(p.x, p.y, p.z - 0.18);
      this.root.add(flame);
      this.exhausts.push({ light, flame });
    }
  }

  _hookHeadlights(model) {
    this._headlightMats = [];
    const seen = new Set();
    model.traverse((o) => {
      if (!o.isMesh) return;
      const on = (o.name || '').toLowerCase();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (let i = 0; i < mats.length; i++) {
        let m = mats[i];
        if (!m) continue;
        const mn = `${m.name || ''} ${on}`.toLowerCase();
        if (
          mn.includes('red') ||
          mn.includes('taillight') ||
          mn.includes('tail_light') ||
          mn.includes('brake')
        ) {
          continue;
        }
        const namedHead =
          mn.includes('headlight') ||
          mn.includes('head_light') ||
          mn.includes('lightglassnormal') ||
          mn.includes('lightglassnormal_clear') ||
          mn.includes('lightglass_clear') ||
          mn.includes('white_glass') ||
          mn.includes('outerclear');
        // Clear / white light glass — not red. Avoid shared Light_Geo (front+rear atlas).
        const clearGlass =
          (mn.includes('light_glass') || mn.includes('lightglass')) &&
          !mn.includes('red') &&
          !mn.includes('orange');
        const frontLightMesh =
          (on.includes('headlight') ||
            on.includes('head_light') ||
            on.includes('bumperf') ||
            on.includes('bumper_f') ||
            on.includes('bumper_f_')) &&
          (mn.includes('light') || mn.includes('glass') || mn.includes('emissive'));
        if (!(namedHead || clearGlass || frontLightMesh)) continue;

        if (!m.userData._headClone) {
          m = m.clone();
          m.userData._headClone = true;
          mats[i] = m;
          if (Array.isArray(o.material)) o.material = mats;
          else o.material = m;
        }
        if (seen.has(m)) continue;
        seen.add(m);
        if (!m.emissive) m.emissive = new THREE.Color(0xf5f8ff);
        else m.emissive.setHex(0xf5f8ff);
        m.emissiveIntensity = 4.5;
        m.toneMapped = false;
        this._headlightMats.push(m);
      }
    });
  }

  _hookEmissiveLights(model) {
    this._emissiveMats = [];
    const seen = new Set();
    model.traverse((o) => {
      if (!o.isMesh) return;
      const on = (o.name || '').toLowerCase();
      const rear =
        on.includes('taillight') ||
        on.includes('tail_light') ||
        on.includes('bumperr') ||
        on.includes('rear') ||
        (on.includes('spoiler') && on.includes('light'));
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (let i = 0; i < mats.length; i++) {
        let m = mats[i];
        if (!m) continue;
        const mn = `${m.name || ''} ${on}`.toLowerCase();
        const isRedGlass =
          mn.includes('lightglass_red') ||
          mn.includes('light_glass_red') ||
          mn.includes('glass_red') ||
          mn.includes('red_glass');
        const isLightCore =
          (mn.includes('light_max') || mn.includes('m_light') || mn.includes('emissive')) &&
          !mn.includes('headlight') &&
          !mn.includes('head_light');
        // Prefer named rear lights; also accept red light glass anywhere on the body.
        if (!(isRedGlass || (rear && isLightCore))) continue;
        // Clone so brake state doesn't light shared headlight mats.
        if (!m.userData._brakeClone) {
          m = m.clone();
          m.userData._brakeClone = true;
          mats[i] = m;
          if (Array.isArray(o.material)) o.material = mats;
          else o.material = m;
        }
        if (seen.has(m)) continue;
        seen.add(m);
        if (!m.emissive) m.emissive = new THREE.Color(0xff0000);
        else m.emissive.setHex(isRedGlass ? 0xff0808 : 0xff0000);
        m.emissiveIntensity = 0.2;
        m.toneMapped = false;
        m.userData._brakeIdle = 0.35;
        m.userData._brakeOn = isRedGlass ? 10 : 12;
        this._emissiveMats.push(m);
      }
    });
  }

  setPose(x, y, z, yaw = 0) {
    this.root.position.set(x, y, z);
    this.yaw = yaw;
    this.root.rotation.y = yaw;
    this.speed = 0;
    this.vx = 0;
    this.vz = 0;
    this.vy = 0;
    this.gear = 1;
    this.rpm = IDLE_RPM;
    this.reversing = false;
    this.airborne = false;
    this.offRoad = false;
    this._brakeHold = 0;
    this._shiftTimer = 0;
    this._shiftDir = 0;
  }

  _autoShift(absLong, drive, delta) {
    if (this._shiftTimer > 0) {
      this._shiftTimer -= delta;
      if (this._shiftTimer <= 0) {
        if (this._shiftDir > 0 && this.gear < GEARS.length) this.gear++;
        if (this._shiftDir < 0 && this.gear > 1) this.gear--;
        this._shiftDir = 0;
      }
      return;
    }
    if (this.gear < 1) this.gear = 1;
    const g = GEARS[this.gear - 1];
    // RPM from road speed through current gear (auto clutch approx).
    const rpmFromSpeed = IDLE_RPM + absLong * g.ratio * FINAL_DRIVE * 48;
    this.rpm = THREE.MathUtils.clamp(rpmFromSpeed + drive * 400, IDLE_RPM, REDLINE + 200);

    if (drive > 0.15 && this.gear < GEARS.length && this.rpm >= SHIFT_UP_RPM) {
      this._shiftTimer = SHIFT_TIME;
      this._shiftDir = 1;
      return;
    }
    if (this.gear > 1 && this.rpm <= SHIFT_DOWN_RPM && absLong < GEARS[this.gear - 2].max * 0.9) {
      this._shiftTimer = SHIFT_TIME * 0.7;
      this._shiftDir = -1;
    }
  }

  update(delta, input, collision) {
    const throttle = input?.throttle || 0;
    const steer = input?.steer || 0;
    const brakeIn = input?.brake || 0;
    const reverseIn = input?.reverse || 0;
    this.throttle = throttle;
    this.steering = steer;

    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);

    let long = this.vx * fx + this.vz * fz;
    let lat = this.vx * rx + this.vz * rz;
    const absLong = Math.abs(long);

    // S/↓/Space/Shift = same brake. ~3× softer / slower build than before.
    // S/↓ also reverse once nearly stopped.
    const wantReverse = reverseIn > 0 && throttle <= 0 && absLong < 1.2;
    this.braking = brakeIn > 0 && !wantReverse;
    if (this.braking) {
      this._brakeHold = Math.min(1, this._brakeHold + delta / 1.05);
    } else {
      this._brakeHold = 0;
    }
    this.brake = this.braking ? this._brakeHold : 0;
    this.reversing = wantReverse || long < -0.5;

    const drive = throttle;
    if (this.reversing || wantReverse) {
      this.gear = 0;
      this.rpm = IDLE_RPM + Math.abs(long) * 90 + (wantReverse ? 900 : 0);
    } else {
      this._autoShift(absLong, Math.max(0, drive), delta);
    }

    const g = this.gear === 0 ? { ratio: 3.2, max: 16 } : GEARS[Math.max(0, this.gear - 1)];
    const shifting = this._shiftTimer > 0;
    const tq = torqueAtRpm(this.rpm);
    let engineAccel;
    if (wantReverse) {
      engineAccel = -16 * tq;
    } else {
      engineAccel = Math.max(0, drive) * (14 + g.ratio * 5.5) * tq;
    }
    if (shifting) engineAccel *= 0.2;

    let drag = 0.28 + absLong * 0.01 + absLong * absLong * 0.0005;
    // Was 38+95*hold — 3× slower stop.
    const brakeDecel = (38 + this._brakeHold * 95) / 3;

    if (this.offRoad) {
      engineAccel *= 0.72;
      drag += 2.5 + absLong * 0.05;
    }
    if (this.airborne) {
      engineAccel *= 0.35;
      drag *= 0.35;
    }

    if (this.braking) {
      engineAccel = 0;
      long -= Math.sign(long || 1) * brakeDecel * delta;
      if (Math.abs(long) < 0.35) long = 0;
    } else {
      long += engineAccel * delta;
      if (Math.abs(long) > 1e-4) long -= Math.sign(long) * drag * delta;
    }
    // Tiny coast snap only — never eat launch thrust (0.06 deadzone pinned the car).
    if (drive === 0 && !this.braking && !wantReverse && Math.abs(long) < 0.02) long = 0;

    const maxFwd = this.offRoad ? g.max * 0.72 : g.max;
    const maxRev = 16;
    long = THREE.MathUtils.clamp(long, -maxRev, maxFwd);

    // Keep RPM honest after integrating speed.
    if (this.gear >= 1) {
      const rpmRoad = IDLE_RPM + Math.abs(long) * g.ratio * FINAL_DRIVE * 48;
      this.rpm = THREE.MathUtils.clamp(
        shifting ? this.rpm * 0.92 : rpmRoad + Math.max(0, drive) * 350,
        IDLE_RPM,
        REDLINE + 150,
      );
    }

    // Steering must always be usable — soft falloff at speed, no dead understeer.
    const absSpd = Math.max(absLong, Math.hypot(this.vx, this.vz));
    let yawRate = 0;
    if (!this.airborne && absSpd > 0.25) {
      // rad/s at full stick: strong at low speed, still turns hard at race speed
      const fullStick = THREE.MathUtils.lerp(2.6, 1.15, Math.min(1, absSpd / 55));
      yawRate = steer * fullStick * Math.sign(long || 1);
      if (this.offRoad) yawRate *= 0.85;
    } else if (!this.airborne && Math.abs(steer) > 0.15 && Math.abs(drive) > 0.1) {
      yawRate = steer * 1.4 * Math.sign(drive);
    }

    this.yaw += yawRate * delta;

    const fx2 = Math.sin(this.yaw);
    const fz2 = Math.cos(this.yaw);
    const rx2 = Math.cos(this.yaw);
    const rz2 = -Math.sin(this.yaw);

    // Keep velocity mostly pointed with the nose (light slip only).
    const grip = this.airborne ? 2 : this.offRoad ? 18 : 32;
    const latBleed = grip * delta;
    if (Math.abs(lat) <= latBleed) lat = 0;
    else lat -= Math.sign(lat) * latBleed;

    this.vx = fx2 * long + rx2 * lat;
    this.vz = fz2 * long + rz2 * lat;
    this.speed = long;

    this.colliding = false;
    let x = this.position.x + this.vx * delta;
    let y = this.position.y;
    let z = this.position.z + this.vz * delta;

    const packs = collision;
    const canCollide =
      packs?.resolve &&
      (packs.ground?.length || packs.terrain?.length || packs.walls?.length || packs.colliders?.length);

    if (canCollide) {
      const res = packs.resolve(packs, this.position, this.yaw, this.speed, delta, {
        vx: this.vx,
        vz: this.vz,
        vy: this.vy,
        airborne: this.airborne,
        y,
      });
      x = res.x;
      z = res.z;
      this.offRoad = res.onRoad === false && (res.onGround || this.airborne);

      if (res.blocked || (res.impact || 0) > 0.35) {
        // Slide along barrier: use resolved velocity (into-wall component already removed).
        if (res.vx != null && res.vz != null) {
          this.vx = res.vx;
          this.vz = res.vz;
        } else if (res.nx || res.nz) {
          const into = this.vx * res.nx + this.vz * res.nz;
          if (into < 0) {
            this.vx -= res.nx * into;
            this.vz -= res.nz * into;
          }
        }
        if (res.speedScale != null && res.speedScale < 1) {
          this.vx *= Math.max(0.45, res.speedScale);
          this.vz *= Math.max(0.45, res.speedScale);
        }
        this.speed = this.vx * Math.sin(this.yaw) + this.vz * Math.cos(this.yaw);
        long = this.speed;
        this.colliding = true;
      } else if (res.speedScale != null && res.speedScale < 1) {
        this.vx *= res.speedScale;
        this.vz *= res.speedScale;
        this.speed *= res.speedScale;
        long = this.speed;
      }

      const surfaceY = res.groundY;
      const hasSurface = surfaceY != null && Number.isFinite(surfaceY);
      const ride = hasSurface ? surfaceY + 0.12 : y;

      if (this.airborne || (hasSurface && y > ride + 0.45) || this.vy > 0.8) {
        this.airborne = true;
        this.vy -= GRAVITY * delta;
        y += this.vy * delta;
        if (hasSurface && y <= ride && this.vy <= 0) {
          y = ride;
          this.vy = 0;
          this.airborne = false;
        }
      } else if (hasSurface) {
        // On ground — stick only while planted; launch off crests.
        const slope = res.slope ?? 0;
        if (slope < -0.12 && absLong > 12) {
          this.vy = Math.min(14, absLong * -slope * 0.85);
          this.airborne = true;
          y = ride + 0.05;
        } else {
          y = ride;
          this.vy = 0;
          this.airborne = false;
        }
        this.offRoad = res.onRoad === false;
      } else {
        this.airborne = true;
        this.vy -= GRAVITY * delta;
        y += this.vy * delta;
      }
    } else {
      this.vy -= GRAVITY * delta;
      y += this.vy * delta;
      this.airborne = true;
    }

    this.root.position.set(x, y, z);
    this.root.rotation.y = this.yaw;
    // Mild body roll / pitch for feel
    const roll = THREE.MathUtils.clamp(-steer * absLong * 0.004, -0.12, 0.12);
    const pitch = THREE.MathUtils.clamp(-this.vy * 0.015 - this.brake * 0.04 + drive * 0.02, -0.1, 0.08);
    this.root.rotation.z = roll;
    this.root.rotation.x = pitch;
    this._updateFx(delta);
  }

  _updateFx(delta) {
    const brakeOn = this.braking && Math.abs(this.speed) > 0.12;
    const revOn = this.reversing && !brakeOn;
    for (const m of this._emissiveMats) {
      const idle = m.userData._brakeIdle ?? 0.12;
      const on = m.userData._brakeOn ?? 22;
      m.emissiveIntensity = brakeOn ? on : idle;
    }
    // Headlights stay on (night race).
    for (const m of this._headlightMats) {
      m.emissiveIntensity = 5.2;
    }
    for (const glow of this._headGlow) {
      glow.intensity = 2.4;
    }
    for (const halo of this._headHalos) {
      halo.material.opacity = 0.55;
      halo.scale.setScalar(2.3);
    }
    for (const glow of this._brakeGlow) {
      glow.intensity = brakeOn ? 6 : 0.04;
    }
    for (const halo of this._brakeHalos) {
      halo.material.opacity = brakeOn ? 0.45 : 0;
      halo.scale.setScalar(brakeOn ? 2.4 : 2.0);
    }
    for (const glow of this._reverseGlow) {
      glow.intensity = revOn ? 8 : 0;
    }

    const boost = Math.max(0, this.throttle) * (0.3 + Math.min(1, Math.abs(this.speed) / 38));
    for (const { light, flame } of this.exhausts) {
      light.intensity = boost * 3.2;
      light.color.setHex(boost > 0.75 ? 0x66ccff : boost > 0.4 ? 0xffaa22 : 0xff3300);
      flame.material.opacity = boost * 0.8;
      flame.material.color.set(boost > 0.75 ? 0x88ddff : 0xff6622);
      flame.scale.setScalar(0.65 + boost * 1.5);
    }
  }

  speedKmh() {
    return Math.round(Math.hypot(this.vx, this.vz) * 3.6);
  }

  dispose() {
    this.scene.remove(this.root);
  }
}
