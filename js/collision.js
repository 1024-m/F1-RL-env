/** Ground + wall collision. BVH-accelerated. TecPro uses solid box proxies. */

import * as THREE from 'three';
import {
  computeBoundsTree,
  disposeBoundsTree,
  acceleratedRaycast,
} from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const NEAR_R = 90;
const CAR_RADIUS = 1.35;
const _center = new THREE.Vector3();
const _n = new THREE.Vector3();
const _move = new THREE.Vector3();
const _pt = new THREE.Vector3();
const _seen = new Set();

function nearMeshes(list, x, z, out) {
  out.length = 0;
  if (!list?.length) return out;
  for (const mesh of list) {
    if (!mesh.geometry?.boundingSphere) {
      mesh.geometry?.computeBoundingSphere?.();
    }
    const bs = mesh.geometry?.boundingSphere;
    if (!bs) {
      out.push(mesh);
      continue;
    }
    _center.copy(bs.center).applyMatrix4(mesh.matrixWorld);
    const dx = _center.x - x;
    const dz = _center.z - z;
    const reach = bs.radius + NEAR_R;
    if (bs.radius > 200 || dx * dx + dz * dz <= reach * reach) out.push(mesh);
  }
  return out;
}

function faceNormal(hit, fallback) {
  if (!hit.face) return fallback.clone();
  return hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
}

/** Collect nearby TecPro box indices from spatial hash. */
function nearbyBarrierBoxes(packs, x, z) {
  const boxes = packs?.barrierBoxes;
  const grid = packs?.barrierGrid;
  const cell = packs?.barrierCellSize || 1.5;
  if (!boxes?.length || !grid) return null;
  const out = [];
  _seen.clear();
  const cx = Math.floor(x / cell);
  const cz = Math.floor(z / cell);
  for (let dx = -3; dx <= 3; dx++) {
    for (let dz = -3; dz <= 3; dz++) {
      const arr = grid.get(`${cx + dx},${cz + dz}`);
      if (!arr) continue;
      for (const i of arr) {
        if (_seen.has(i)) continue;
        _seen.add(i);
        out.push(boxes[i]);
      }
    }
  }
  return out;
}

const CAR_PROBES = [
  [0, 0.45, 0],
  [0, 0.45, 2.2],
  [0, 0.45, 1.2],
  [0, 0.45, -1.8],
  [0.95, 0.45, 1.1],
  [-0.95, 0.45, 1.1],
  [0.95, 0.45, -0.9],
  [-0.95, 0.45, -0.9],
  [0, 0.9, 1.5],
  [0, 0.9, -1.2],
];

/**
 * Solid resolve vs TecPro AABB proxies + slide along the wall.
 */
function resolveTecProBoxes(packs, x, y, z, yaw, vx, vz) {
  const nearby = nearbyBarrierBoxes(packs, x, z);
  if (!nearby?.length) {
    return { x, z, blocked: false, speedScale: 1, impact: 0, nx: 0, nz: 0, vx, vz };
  }

  const fwdX = Math.sin(yaw);
  const fwdZ = Math.cos(yaw);
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);

  let blocked = false;
  let speedScale = 1;
  let impact = 0;
  let nx = 0;
  let nz = 0;
  let px = x;
  let pz = z;
  let ovx = vx;
  let ovz = vz;

  for (let iter = 0; iter < 6; iter++) {
    let pushed = false;
    for (const [lx, ly, lz] of CAR_PROBES) {
      const wx = px + rightX * lx + fwdX * lz;
      const wy = y + ly;
      const wz = pz + rightZ * lx + fwdZ * lz;
      _pt.set(wx, wy, wz);

      for (const box of nearby) {
        if (wy < box.min.y - 0.15 || wy > box.max.y + 0.25) continue;

        const inside = box.containsPoint(_pt);
        const cx = THREE.MathUtils.clamp(wx, box.min.x, box.max.x);
        const cz = THREE.MathUtils.clamp(wz, box.min.z, box.max.z);
        const dx0 = wx - cx;
        const dz0 = wz - cz;
        const dist = Math.hypot(dx0, dz0);
        const radius = 0.55;

        if (inside) {
          const toMinX = wx - box.min.x;
          const toMaxX = box.max.x - wx;
          const toMinZ = wz - box.min.z;
          const toMaxZ = box.max.z - wz;
          const m = Math.min(toMinX, toMaxX, toMinZ, toMaxZ);
          let dx = 0;
          let dz = 0;
          if (m === toMinX) {
            dx = -toMinX - 0.12;
            nx = -1;
            nz = 0;
          } else if (m === toMaxX) {
            dx = toMaxX + 0.12;
            nx = 1;
            nz = 0;
          } else if (m === toMinZ) {
            dz = -toMinZ - 0.12;
            nx = 0;
            nz = -1;
          } else {
            dz = toMaxZ + 0.12;
            nx = 0;
            nz = 1;
          }
          px += dx;
          pz += dz;
          blocked = true;
          pushed = true;
          impact = 1;
          speedScale = Math.min(speedScale, 0.55);
          break;
        }

        if (dist > 1e-6 && dist < radius) {
          const push = radius - dist;
          nx = dx0 / dist;
          nz = dz0 / dist;
          px += nx * push;
          pz += nz * push;
          blocked = true;
          pushed = true;
          impact = Math.max(impact, 0.7);
          speedScale = Math.min(speedScale, 0.65);
        }
      }
    }
    if (!pushed) break;
  }

  // Slide: remove only velocity into the wall.
  if (blocked && (nx || nz)) {
    const into = ovx * nx + ovz * nz;
    if (into < 0) {
      ovx -= nx * into;
      ovz -= nz * into;
      impact = Math.max(impact, 0.85);
    }
  }

  return { x: px, z: pz, blocked, speedScale, impact, nx, nz, vx: ovx, vz: ovz };
}

export class CollisionSystem {
  constructor() {
    this.ray = new THREE.Raycaster();
    this.ray.firstHitOnly = false;
    this._down = new THREE.Vector3(0, -1, 0);
    this._hits = [];
    this._groundNear = [];
    this._wallNear = [];
    this.groundY = 0;
    this.onGround = false;
    this.wallNormal = null;
  }

  groundAt(groundMeshes, x, z, fromY = 80, preferY = null) {
    const list = nearMeshes(groundMeshes, x, z, this._groundNear);
    if (!list.length) return null;
    this.ray.set(new THREE.Vector3(x, fromY, z), this._down);
    this.ray.far = fromY + 80;
    this._hits.length = 0;
    this.ray.intersectObjects(list, false, this._hits);

    const candidates = [];
    for (const h of this._hits) {
      const n = faceNormal(h, new THREE.Vector3(0, 1, 0));
      if (n.y < 0.4) continue;
      candidates.push({ y: h.point.y, normal: n });
      if (candidates.length >= 4) break;
    }
    if (!candidates.length) return null;

    if (preferY == null) {
      return candidates.reduce((a, b) => (a.y >= b.y ? a : b));
    }

    const band = candidates.filter((c) => Math.abs(c.y - preferY) < 6);
    const pool = band.length ? band : candidates;
    return pool.reduce((a, b) =>
      Math.abs(a.y - preferY) <= Math.abs(b.y - preferY) ? a : b,
    );
  }

  resolve(packs, position, yaw, speed, delta, state = {}) {
    const road = packs?.ground || [];
    const terrain = packs?.terrain || [];
    const walls = packs?.walls || packs?.colliders || [];
    const heightMeshes =
      road.length || terrain.length ? road.concat(terrain) : packs?.colliders || [];

    const vx = state.vx != null ? state.vx : Math.sin(yaw) * speed;
    const vz = state.vz != null ? state.vz : Math.cos(yaw) * speed;
    const carY = state.y != null ? state.y : position.y;

    if (!heightMeshes.length && !walls.length && !packs?.barrierBoxes?.length) {
      return {
        x: position.x + vx * delta,
        z: position.z + vz * delta,
        groundY: null,
        blocked: false,
        onGround: false,
        onRoad: false,
        speedScale: 1,
        impact: 0,
        slope: 0,
      };
    }

    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

    let x = position.x + vx * delta;
    let z = position.z + vz * delta;
    let blocked = false;
    let speedScale = 1;
    let impact = 0;
    this.wallNormal = null;

    const probeY = Math.max(carY + 25, 40);
    const sampleSurface = (px, pz) => {
      const asphalt = this.groundAt(road, px, pz, probeY, carY);
      if (asphalt) return { y: asphalt.y, road: true };
      const dirt = this.groundAt(
        terrain.length ? terrain : heightMeshes,
        px,
        pz,
        probeY,
        carY,
      );
      if (dirt) return { y: dirt.y, road: false };
      return null;
    };

    // 1) TecPro / Nuove_Barriere — solid box proxies + slide.
    let slideVx = vx;
    let slideVz = vz;
    let wallNx = 0;
    let wallNz = 0;
    if (packs?.barrierBoxes?.length) {
      const br = resolveTecProBoxes(packs, x, carY, z, yaw, vx, vz);
      x = br.x;
      z = br.z;
      if (br.blocked) {
        blocked = true;
        impact = Math.max(impact, br.impact);
        speedScale = Math.min(speedScale, br.speedScale);
        slideVx = br.vx;
        slideVz = br.vz;
        wallNx = br.nx;
        wallNz = br.nz;
        this.wallNormal = new THREE.Vector3(br.nx, 0, br.nz);
      }
    }

    // 2) Other walls — ray sweep only (unchanged for rest of track).
    if (walls.length) {
      const wallList = nearMeshes(
        walls.filter((w) => !w.userData?.barrier),
        position.x,
        position.z,
        this._wallNear,
      );
      const speedH = Math.hypot(vx, vz);
      const driveDir =
        speedH > 0.05
          ? new THREE.Vector3(vx / speedH, 0, vz / speedH)
          : fwd.clone();

      if (speedH > 0.05 && wallList.length) {
        this.ray.firstHitOnly = false;
        const travel = Math.max(2.8, Math.min(8.0, speedH * delta * 2.5 + 2.8));
        let best = null;
        for (const hy of [0.35, 0.7, 1.1]) {
          this.ray.set(new THREE.Vector3(position.x, carY + hy, position.z), driveDir);
          this.ray.far = travel;
          this._hits.length = 0;
          this.ray.intersectObjects(wallList, false, this._hits);
          for (const hit of this._hits) {
            if (hit.distance > travel) continue;
            const n = faceNormal(hit, driveDir.clone().multiplyScalar(-1));
            const score = (1 - Math.abs(n.y)) * 2 + 1 / (hit.distance + 0.05);
            if (!best || score > best.score) best = { hit, score, n };
          }
          if (best && best.hit.distance < 1.0) break;
        }
        if (best && best.hit.distance < CAR_RADIUS + 0.4) {
          _n.copy(best.n);
          if (_n.y > 0.45) _n.set(-driveDir.x, 0, -driveDir.z);
          else _n.y = 0;
          if (_n.lengthSq() > 1e-6) {
            _n.normalize();
            _move.set(x - position.x, 0, z - position.z);
            const along = _move.dot(_n);
            if (along < 0) _move.addScaledVector(_n, -along);
            _move.addScaledVector(_n, Math.max(0.2, CAR_RADIUS - best.hit.distance));
            x = position.x + _move.x;
            z = position.z + _move.z;
            blocked = true;
            speedScale = Math.min(speedScale, 0.35);
            this.wallNormal = _n.clone();
            impact = Math.max(impact, 0.7);
          }
        }
        this.ray.firstHitOnly = false;
      }
    }

    const under = sampleSurface(x, z);
    const ahead = sampleSurface(x + fwd.x * 4.0, z + fwd.z * 4.0);
    let groundY = under ? under.y : null;
    const onRoad = !!(under && under.road);
    let slope = 0;
    if (under && ahead) slope = (ahead.y - under.y) / 4.0;

    if (!under) {
      const deep = this.groundAt(heightMeshes, x, z, Math.max(carY + 80, 100), null);
      if (deep) groundY = deep.y;
    }

    const onGround =
      groundY != null && carY <= groundY + 0.55 && (state.vy == null || state.vy <= 0.5);

    this.onGround = onGround;
    if (groundY != null) this.groundY = groundY;

    return {
      x,
      z,
      groundY,
      blocked,
      onGround,
      onRoad,
      speedScale,
      impact,
      slope,
      nx: wallNx || (this.wallNormal ? this.wallNormal.x : 0),
      nz: wallNz || (this.wallNormal ? this.wallNormal.z : 0),
      vx: slideVx,
      vz: slideVz,
    };
  }

  snapSpawn(groundMeshes, x, z, yaw, expectedY) {
    const g = this.groundAt(groundMeshes, x, z, Math.max(expectedY + 40, 80), expectedY);
    if (!g) return { x, y: expectedY, z, yaw };
    if (Math.abs(g.y - expectedY) > 8) return { x, y: expectedY, z, yaw };
    return { x, y: g.y + 0.15, z, yaw };
  }
}

export function bakeCollider(mesh) {
  if (!mesh?.isMesh || !mesh.geometry) return;
  if (!mesh.geometry.boundsTree) {
    try {
      mesh.geometry.computeBoundsTree({ maxLeafTris: 20 });
    } catch (err) {
      console.warn('BVH bake failed', mesh.name || mesh.material?.name, err);
    }
  }
  if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
}

export function disposeCollider(mesh) {
  mesh?.geometry?.disposeBoundsTree?.();
}
