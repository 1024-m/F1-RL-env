/**
 * Visual-only stadium floodlights.
 * Bright LED banks you can see — zero Spot/Point lights.
 * Fog disabled on fixtures so night fog cannot erase them.
 */

import * as THREE from 'three';

const PATH_URL = 'js/floodlight-path.json';
const MAST_H = 55;
const MIN_MAST_SEP = 320;

function matBasic(color, opts = {}) {
  return new THREE.MeshBasicMaterial({
    color,
    fog: false,
    toneMapped: false,
    ...opts,
  });
}

const steelPole = matBasic(0xc4cad2);
const steelDark = matBasic(0x222228);

function makeLedPanelTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#0a0a0e';
  g.fillRect(0, 0, 256, 128);
  for (const ox of [8, 136]) {
    g.fillStyle = '#050508';
    g.fillRect(ox, 8, 112, 112);
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 2; col++) {
        const cx = ox + 28 + col * 56;
        const cy = 20 + row * 16;
        const grd = g.createRadialGradient(cx, cy, 0, cx, cy, 11);
        grd.addColorStop(0, '#ffffff');
        grd.addColorStop(0.3, '#f5f8ff');
        grd.addColorStop(0.65, '#d0dcff');
        grd.addColorStop(1, '#243048');
        g.fillStyle = grd;
        g.beginPath();
        g.arc(cx, cy, 11, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let _ledTex = null;
function ledTex() {
  if (!_ledTex) _ledTex = makeLedPanelTexture();
  return _ledTex;
}

function makeGlowSprite(scaleX, scaleY) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(235,242,255,0.7)');
  grd.addColorStop(0.55, 'rgba(200,215,255,0.25)');
  grd.addColorStop(1, 'rgba(160,180,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      fog: false,
      opacity: 1,
    }),
  );
  spr.scale.set(scaleX, scaleY, 1);
  spr.renderOrder = 3;
  return spr;
}

function makeHeadframe() {
  const head = new THREE.Group();
  const w = 18;
  const h = 10;

  head.add(
    new THREE.Mesh(new THREE.BoxGeometry(w + 1, h + 1, 0.4), steelDark),
  );

  const faceMat = matBasic(0xffffff, {
    map: ledTex(),
    side: THREE.DoubleSide,
  });

  const cols = 4;
  const rows = 3;
  const fw = (w - 0.6) / cols;
  const fh = (h - 0.6) / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const housing = new THREE.Mesh(
        new THREE.BoxGeometry(fw - 0.1, fh - 0.1, 0.5),
        steelDark,
      );
      const face = new THREE.Mesh(
        new THREE.PlaneGeometry(fw - 0.25, fh - 0.25),
        faceMat,
      );
      face.position.z = 0.28;
      face.renderOrder = 2;
      const unit = new THREE.Group();
      unit.add(housing, face);
      unit.position.set(
        -w / 2 + fw / 2 + 0.3 + c * fw,
        -h / 2 + fh / 2 + 0.3 + r * fh,
        0.2,
      );
      unit.rotation.x = 0.35;
      head.add(unit);
    }
  }

  // Big sky glow — billboard sprite, fog-proof, does not light the world.
  const glow = makeGlowSprite(48, 30);
  glow.position.set(0, 0, 2);
  head.add(glow);

  return head;
}

function makeMast() {
  const root = new THREE.Group();
  root.frustumCulled = false;

  const sections = [
    { h: 18, rBot: 1.2, rTop: 0.95 },
    { h: 18, rBot: 0.95, rTop: 0.7 },
    { h: 15, rBot: 0.7, rTop: 0.5 },
    { h: 4, rBot: 0.5, rTop: 0.45 },
  ];
  let y = 0;
  for (const s of sections) {
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(s.rTop, s.rBot, s.h, 12),
      steelPole,
    );
    m.position.y = y + s.h / 2;
    m.frustumCulled = false;
    root.add(m);
    y += s.h;
  }

  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(2.8, 3.0, 0.4, 12),
    steelDark,
  );
  collar.position.y = MAST_H - 0.3;
  root.add(collar);

  const head = makeHeadframe();
  head.position.set(0, MAST_H + 5, 1.6);
  root.add(head);

  // Extra sky blob so you always see "a light" even if bank faces away.
  const tip = makeGlowSprite(22, 22);
  tip.position.set(0, MAST_H + 5, 0);
  root.add(tip);

  return root;
}

/** Spaced around circuit; first two sit in the start/finish chase view. */
const FALLBACK = [
  { x: -145, y: -3.2, z: 420, aimX: -109, aimY: -3.2, aimZ: 379 },
  { x: -70, y: -3.2, z: 410, aimX: -109, aimY: -3.2, aimZ: 379 },
  { x: -538, y: -1.7, z: 110, aimX: -532, aimY: -1.7, aimZ: 52 },
  { x: -286, y: -1.0, z: -480, aimX: -229, aimY: -1.0, aimZ: -491 },
  { x: 162, y: -3.4, z: -258, aimX: 128, aimY: -3.4, aimZ: -211 },
  { x: 369, y: -0.7, z: 180, aimX: 347, aimY: -0.7, aimZ: 234 },
];

function pickMasts(raw) {
  const sep2 = MIN_MAST_SEP * MIN_MAST_SEP;
  // Always keep the two start/finish masts (may be closer than MIN_MAST_SEP).
  const kept = raw.slice(0, 2).map((m) => ({ ...m }));
  for (let i = 2; i < raw.length; i++) {
    const m = raw[i];
    if (kept.some((k) => (k.x - m.x) ** 2 + (k.z - m.z) ** 2 < sep2)) continue;
    kept.push(m);
    if (kept.length >= 6) break;
  }
  return kept;
}

export class CricketFloodlights {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'cricket-floodlights';
    this.root.frustumCulled = false;
    scene.add(this.root);
    this.masts = [];
    this.ready = false;
  }

  bindCar(_carRoot) {}

  async install(_roadMeshes = []) {
    // Re-install allowed after code reload / re-enter.
    while (this.root.children.length) {
      this.root.remove(this.root.children[0]);
    }
    this.masts.length = 0;

    let data = { masts: [] };
    try {
      const res = await fetch(`${PATH_URL}?v=44`);
      if (res.ok) data = await res.json();
    } catch (_) {
      /* FALLBACK */
    }

    // Prefer FALLBACK for guaranteed start-line visibility; merge path extras.
    const source = [...FALLBACK, ...(data.masts || [])];
    const kept = pickMasts(source);

    for (const m of kept) {
      const mesh = makeMast();
      mesh.position.set(m.x, m.y, m.z);
      mesh.rotation.y = Math.atan2(m.aimX - m.x, m.aimZ - m.z);
      this.root.add(mesh);
      this.masts.push({ mesh, x: m.x, z: m.z });
    }

    this.ready = true;
    console.info(
      `[floodlights] VISIBLE visual-only masts=${kept.length}`,
      kept.map((m) => `(${m.x|0},${m.z|0})`).join(' '),
    );
  }

  update(carPos) {
    if (!this.ready || !carPos) return;
    for (const m of this.masts) {
      const dx = m.x - carPos.x;
      const dz = m.z - carPos.z;
      m.mesh.visible = dx * dx + dz * dz < 1200 * 1200;
    }
  }
}

export function buildNightSky(scene) {
  const group = new THREE.Group();
  group.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(1400, 20, 12),
      new THREE.MeshBasicMaterial({
        color: 0x030408,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    ),
  );
  const cloudTex = makeCloudTexture();
  const clouds = [];
  for (let i = 0; i < 4; i++) {
    const c = new THREE.Mesh(
      new THREE.PlaneGeometry(560, 220),
      new THREE.MeshBasicMaterial({
        map: cloudTex,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        color: 0x5a6270,
        side: THREE.DoubleSide,
        fog: false,
      }),
    );
    c.position.set((i - 1.5) * 220, 200 + (i % 2) * 30, (i % 3) * 100 - 100);
    c.rotation.x = -Math.PI / 2.35;
    group.add(c);
    clouds.push(c);
  }
  scene.add(group);
  return {
    group,
    update(delta, carPos) {
      if (carPos) group.position.set(carPos.x, 0, carPos.z);
      for (let i = 0; i < clouds.length; i++) {
        clouds[i].position.x += (2.5 + i * 0.5) * delta;
        if (clouds[i].position.x > 650) clouds[i].position.x = -650;
      }
    },
  };
}

function makeCloudTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 22; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 128;
    const r = 30 + Math.random() * 55;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(110,115,125,0.55)');
    grd.addColorStop(1, 'rgba(30,35,45,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function applyNightLighting(scene, renderer, { ambient, hemi, sun }) {
  scene.background = new THREE.Color(0x030408);
  scene.fog = new THREE.Fog(0x080c14, 90, 600);
  ambient.color.setHex(0x1a2434);
  ambient.intensity = 0.14;
  hemi.color.setHex(0x2a384c);
  hemi.groundColor.setHex(0x060504);
  hemi.intensity = 0.18;
  sun.color.setHex(0x6a7a99);
  sun.intensity = 0.04;
  sun.castShadow = false;
  renderer.shadowMap.enabled = false;
  renderer.toneMappingExposure = 0.95;
}
