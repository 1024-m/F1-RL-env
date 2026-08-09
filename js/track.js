/**
 * Shanghai International Circuit.
 * Source GLB root already rotates Z-up → Y-up — do not add another -PI/2.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { bakeCollider } from './collision.js';

const MAP_URL = 'assets/maps/shanghai/track.glb';
const START_URL = 'js/start-pose.json';

/** Along asphalt centerline toward SF (~−80°), not pure −X (−90°) — that looked diagonal. */
export const RACE_YAW = -1.3920883164888065;

function matName(mesh) {
  const m = mesh.material;
  if (Array.isArray(m)) return (m[0]?.name || '').toString();
  return (m?.name || '').toString();
}

function texBlob(mesh) {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const parts = [];
  for (const m of mats) {
    if (!m) continue;
    parts.push(m.name || '');
    for (const key of ['map', 'emissiveMap', 'normalMap', 'roughnessMap']) {
      const tex = m[key];
      if (!tex) continue;
      parts.push(tex.name || '', tex.image?.name || '', tex.source?.data?.src || '');
    }
  }
  return parts.join(' ').toLowerCase();
}

function texHas(mesh, needles) {
  const blob = texBlob(mesh);
  return needles.some((n) => blob.includes(n));
}

function shouldRemoveMat(name) {
  const n = (name || '').toLowerCase();
  return (
    n.includes('blocchi') ||
    n.includes('blok_dist') ||
    n === 'blok_dist' ||
    n === '#material-03' ||
    n === 'wall8'
  );
}

function textureLooksLikeJunk(mesh) {
  return texHas(mesh, ['blocchi', 'allianz_board']);
}

function isRoadMat(name, mesh) {
  const n = (name || '').toLowerCase();
  if (
    n.includes('line_asf') ||
    n === 'tarmac' ||
    n.includes('pit_lane') ||
    n.includes('linea_pit') ||
    n === 'out' ||
    n.startsWith('out_') ||
    n.includes('runoff') ||
    n.includes('transition')
  ) {
    return true;
  }
  if (texHas(mesh, ['sha_tarmac', 'asfalto_nuovo', 'pat_asf_out', 'sha_runoff', 'sha_transition', 'sha_cloaca', 'sha_brick'])) {
    return true;
  }
  return false;
}

function isTerrainMat(name, mesh) {
  if (isRoadMat(name, mesh)) return false;
  const n = (name || '').toLowerCase();
  if (
    n === 'prato' ||
    n === 'base' ||
    n === 'base!0' ||
    n.includes('kerb') ||
    n.includes('gridline') ||
    n.includes('skid') ||
    n.includes('raceline') ||
    n.includes('rumble') ||
    n.includes('sand') ||
    n.includes('bank') ||
    n.includes('pirelli_terra') ||
    n.includes('rug')
  ) {
    return true;
  }
  return texHas(mesh, [
    'sha_rumble',
    'sha_sand',
    'sha_bank',
    'sha_rug',
    'sha_grid',
    'grass',
    'kerb',
    'sha_aqueduct',
    'sha_water',
    'skid_marks',
    'pat_rug',
  ]);
}

function isWallMat(name, mesh) {
  if (shouldRemoveMat(name) || textureLooksLikeJunk(mesh)) return false;
  if (isRoadMat(name, mesh) || isTerrainMat(name, mesh)) return false;

  const n = (name || '').toLowerCase();
  const nameHit = [
    'barriere', 'barrier', 'muro', 'rail', 'recinto', 'bollard', 'armco', 'wirefence',
    'tractor', 'van', 'truck', 'crane', 'marshal', 'marshall', 'hut', 'pole',
    'furniture', 'jumbotron', 'clock', 'recovery', 'marquee', 'car_b', 'safety',
    'building', 'grandstand', 'garage', 'banner', 'tent', 'podium', 'comms',
    'kart', 'skybridge', 'wc', 'tower', 'baffle', 'wired', 'ranking', 'advert',
    'screen', 'display', 'poster', 'light_aux', 'start_light', 'sign_60',
    'tractor_tv', 'safetyvan', 'marquee_truck', 'pit_exit_light', 'brake_board',
  ].some((k) => n.includes(k));

  if (nameHit) return true;
  if (n.includes('wall') && n !== 'wall8') return true;
  if (n.includes('sponsor')) return true;

  return texHas(mesh, [
    'sha_wall',
    'sha_barrier',
    'armco',
    'fence',
    'fence_barbed',
    'nuove barriere',
    'nuove_barriere',
    'tractor_tv',
    'van_safety',
    'gru_mobole',
    'gru_',
    'retro_marshall',
    'marshal',
    'sha_hut',
    'sha_pole',
    'sha_building',
    'sha_grandstand',
    'sha_banner',
    'sha_furniture',
    'jumbotron',
    'marquee_truck',
    'recovery',
    'sha_tent',
    'sha_prefab',
    'sha_sign',
    'core_start_lights',
    'light_auxrace',
    'lg_pit_exit_light',
    'sha_infrastructure',
    'advert_side',
    'rolex_clock',
    'conc_bollard',
    'sha_brake_boards',
    'sponsor_backboard',
    'sponsor_backframe',
  ]);
}

/** Tire-top TecPro (Nuove) + red/white blocks (not_skin!0 / not_skin!1). */
function isSolidBarrier(name, mesh) {
  const n = (name || '').toLowerCase();
  const blob = `${n} ${texBlob(mesh)}`;
  return (
    n.includes('barriere') ||
    n.includes('not_skin') ||
    blob.includes('nuove barriere') ||
    blob.includes('nuove_barriere') ||
    blob.includes('sponsorx_cats_var')
  );
}

function isTreeMat(name, mesh) {
  const n = (name || '').toLowerCase();
  const blob = `${n} ${texBlob(mesh)}`;
  return (
    n.includes('tree') ||
    blob.includes('tree04') ||
    blob.includes('tree06') ||
    blob.includes('treeline')
  );
}

/** Billboard trees: punch out texture alpha (GLB omitted alphaMode). */
function applyTreeAlpha(mesh) {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) {
    if (!m) continue;
    m.side = THREE.DoubleSide;
    m.alphaTest = 0.45;
    m.transparent = false;
    m.depthWrite = true;
    if (m.map) {
      m.map.premultiplyAlpha = false;
      m.map.needsUpdate = true;
    }
    m.needsUpdate = true;
  }
}

function mergeBarrierBuild(track, built) {
  const base = track.barrierBoxes.length;
  for (const box of built.boxes) track.barrierBoxes.push(box);
  for (const [key, arr] of built.grid) {
    let dest = track.barrierGrid.get(key);
    if (!dest) {
      dest = [];
      track.barrierGrid.set(key, dest);
    }
    for (const i of arr) dest.push(base + i);
  }
  track.barrierCellSize = built.cellSize;
}

/**
 * Solid XZ boxes from TecPro verts.
 * Do NOT drop flat cells — top-only samples were discarded (height < 0.35)
 * and left holes the car could drive through.
 */
function buildBarrierBoxes(mesh) {
  mesh.updateMatrixWorld(true);
  const pos = mesh.geometry?.attributes?.position;
  if (!pos) return { boxes: [], grid: new Map(), cellSize: 1.5 };

  const cellSize = 1.5;
  const cells = new Map();
  const v = new THREE.Vector3();
  const step = 3;
  const minBarrierH = 1.15;

  for (let i = 0; i < pos.count; i += step) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    if (v.y < -6 || v.y > 5) continue;
    const cx = Math.floor(v.x / cellSize);
    const cz = Math.floor(v.z / cellSize);
    const key = `${cx},${cz}`;
    let b = cells.get(key);
    if (!b) {
      b = {
        minx: v.x,
        maxx: v.x,
        miny: v.y,
        maxy: v.y,
        minz: v.z,
        maxz: v.z,
        n: 0,
      };
      cells.set(key, b);
    }
    b.minx = Math.min(b.minx, v.x);
    b.maxx = Math.max(b.maxx, v.x);
    b.miny = Math.min(b.miny, v.y);
    b.maxy = Math.max(b.maxy, v.y);
    b.minz = Math.min(b.minz, v.z);
    b.maxz = Math.max(b.maxz, v.z);
    b.n++;
  }

  const boxes = [];
  const grid = new Map();
  const pad = 0.4;

  for (const b of cells.values()) {
    if (b.n < 2) continue;
    let miny = b.miny;
    let maxy = b.maxy;
    // Flat top-only cell → still a solid wall; grow down to barrier height.
    if (maxy - miny < minBarrierH) miny = maxy - minBarrierH;
    if (maxy < -5.5) continue;

    const box = new THREE.Box3(
      new THREE.Vector3(b.minx - pad, miny, b.minz - pad),
      new THREE.Vector3(b.maxx + pad, maxy + 0.15, b.maxz + pad),
    );
    const i = boxes.length;
    boxes.push(box);
    const c0x = Math.floor(box.min.x / cellSize);
    const c1x = Math.floor(box.max.x / cellSize);
    const c0z = Math.floor(box.min.z / cellSize);
    const c1z = Math.floor(box.max.z / cellSize);
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        const key = `${cx},${cz}`;
        let arr = grid.get(key);
        if (!arr) {
          arr = [];
          grid.set(key, arr);
        }
        arr.push(i);
      }
    }
  }

  return { boxes, grid, cellSize };
}

function yieldFrame() {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

export class Track {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    this._loader = new GLTFLoader();
    this.mapId = null;
    this.ready = false;
    this.ground = [];
    this.terrain = [];
    this.walls = [];
    this.colliders = [];
    /** @type {THREE.Box3[]} solid TecPro proxies */
    this.barrierBoxes = [];
    this.barrierGrid = new Map();
    this.barrierCellSize = 1.5;
    this.loadProgress = 0;
    this.loadPhase = 'idle';
    this.start = { x: -108.96, y: -3.16, z: 378.91, yaw: RACE_YAW };
  }

  async loadShanghai(onProgress) {
    const report = (p, phase) => {
      this.loadProgress = p;
      this.loadPhase = phase;
      if (onProgress) onProgress(p, phase);
    };

    try {
      report(0.05, 'download');
      const poseP = fetch(START_URL).then((r) => r.json()).catch(() => null);

      const res = await fetch(MAP_URL);
      if (!res.ok) throw new Error(`map HTTP ${res.status}`);
      report(0.4, 'download');
      const buf = await res.arrayBuffer();
      report(0.55, 'parse');
      await yieldFrame();

      const gltf = await this._loader.parseAsync(buf, MAP_URL.replace(/[^/]+$/, ''));
      const pose = await poseP;

      if (pose?.world?.pole) {
        this.start = {
          x: pose.world.pole.x,
          y: pose.world.pole.y,
          z: pose.world.pole.z,
          yaw: pose.world.pole.yaw ?? RACE_YAW,
        };
      }

      report(0.85, 'build');
      await yieldFrame();

      while (this.root.children.length) this.root.remove(this.root.children[0]);
      this.ground = [];
      this.terrain = [];
      this.walls = [];
      this.colliders = [];
      this.barrierBoxes = [];
      this.barrierGrid = new Map();

      const model = gltf.scene;
      this.root.add(model);
      model.updateMatrixWorld(true);

      model.traverse((o) => {
        if (!o.isMesh) return;
        o.receiveShadow = true;
        o.castShadow = false;
        const name = matName(o);
        if (shouldRemoveMat(name) || textureLooksLikeJunk(o)) {
          o.visible = false;
          o.raycast = () => {};
          return;
        }

        if (isTreeMat(name, o)) {
          applyTreeAlpha(o);
          return;
        }

        if (isSolidBarrier(name, o)) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            if (m) m.side = THREE.DoubleSide;
          }
          o.userData.barrier = true;
          o.castShadow = true;
          bakeCollider(o);
          this.walls.push(o);
          mergeBarrierBuild(this, buildBarrierBoxes(o));
          return;
        }

        if (isRoadMat(name, o)) {
          bakeCollider(o);
          this.ground.push(o);
        } else if (isTerrainMat(name, o)) {
          bakeCollider(o);
          this.terrain.push(o);
        } else if (isWallMat(name, o)) {
          o.castShadow = true;
          bakeCollider(o);
          this.walls.push(o);
        }
      });

      this.colliders = this.ground.concat(this.terrain, this.walls);
      this.mapId = 'shanghai';
      this.ready = true;
      report(1, 'done');
      console.info(
        `[track] road=${this.ground.length} terrain=${this.terrain.length} walls=${this.walls.length}` +
          ` solidBarrierBoxes=${this.barrierBoxes.length}`,
      );
      return true;
    } catch (err) {
      console.warn('map load failed', err);
      this.ready = false;
      report(0, 'error');
      return false;
    }
  }

  getGridPose(index = 0) {
    const i = Math.max(0, index | 0);
    const row = Math.floor(i / 2);
    const side = i % 2 === 0 ? -1 : 1;
    const yaw = this.start?.yaw ?? RACE_YAW;
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const pos = new THREE.Vector3(this.start.x, this.start.y, this.start.z);
    pos.addScaledVector(forward, -row * 8.0);
    pos.addScaledVector(right, side * 3.4);
    return { x: pos.x, y: pos.y, z: pos.z, yaw };
  }
}
