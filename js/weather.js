/**
 * Rain streaks + subtle damp asphalt (not plastic chrome).
 */

import * as THREE from 'three';

const DROP_COUNT = 500;
const FALL_SPEED = 42;

export class Weather {
  constructor(scene) {
    this.scene = scene;
    this.enabled = true;
    this._wetApplied = false;
    this._drops = new Float32Array(DROP_COUNT * 4); // x,y,z,len
    for (let i = 0; i < DROP_COUNT; i++) {
      this._respawn(i, true);
    }

    const positions = new Float32Array(DROP_COUNT * 2 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this._posAttr = geo.attributes.position;

    const mat = new THREE.LineBasicMaterial({
      color: 0x8a9aaa,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    this.lines = new THREE.LineSegments(geo, mat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 5;
    scene.add(this.lines);

    const mistGeo = new THREE.PlaneGeometry(100, 100);
    const mistMat = new THREE.MeshBasicMaterial({
      color: 0x7a90a0,
      transparent: true,
      opacity: 0.05,
      depthWrite: false,
    });
    this.mist = new THREE.Mesh(mistGeo, mistMat);
    this.mist.rotation.x = -Math.PI / 2;
    this.mist.renderOrder = 4;
    scene.add(this.mist);
  }

  _respawn(i, randomY) {
    const o = i * 4;
    this._drops[o] = (Math.random() - 0.5) * 72;
    this._drops[o + 1] = randomY ? Math.random() * 36 : 16 + Math.random() * 24;
    this._drops[o + 2] = (Math.random() - 0.5) * 72;
    this._drops[o + 3] = 0.55 + Math.random() * 1.35;
  }

  applyWet(meshes) {
    if (this._wetApplied) return;
    this._wetApplied = true;
    for (const mesh of meshes || []) {
      if (!mesh?.isMesh) continue;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (!m || m.userData._wetDone) continue;
        // Damp asphalt, not chrome plastic: keep roughness high, metalness near zero.
        if (m.roughness != null) {
          const r = m.roughness ?? 1;
          m.roughness = THREE.MathUtils.clamp(r * 0.85, 0.45, 0.92);
        }
        if (m.metalness != null) {
          m.metalness = Math.min(m.metalness ?? 0, 0.06);
        }
        if (m.envMapIntensity != null) {
          m.envMapIntensity = Math.min(1.05, (m.envMapIntensity ?? 1) * 1.05);
        }
        if (m.color) m.color.multiplyScalar(0.92);
        m.userData._wetDone = true;
        m.needsUpdate = true;
      }
    }
  }

  update(delta, camera, carPos) {
    if (!this.enabled) {
      this.lines.visible = false;
      this.mist.visible = false;
      return;
    }
    this.lines.visible = true;
    this.mist.visible = true;

    const ox = carPos?.x ?? camera.position.x;
    const oy = carPos?.y ?? camera.position.y;
    const oz = carPos?.z ?? camera.position.z;
    this.lines.position.set(ox, oy, oz);
    this.mist.position.set(ox, oy + 0.06, oz);

    const windX = 5.5;
    const windZ = 1.4;
    const arr = this._posAttr.array;
    const dt = Math.min(0.05, delta);

    for (let i = 0; i < DROP_COUNT; i++) {
      const o = i * 4;
      this._drops[o] += windX * dt;
      this._drops[o + 1] -= FALL_SPEED * dt * (0.7 + (i % 7) * 0.06);
      this._drops[o + 2] += windZ * dt;
      if (this._drops[o + 1] < -10) this._respawn(i, false);
      if (this._drops[o] > 36) this._drops[o] -= 72;
      if (this._drops[o] < -36) this._drops[o] += 72;
      if (this._drops[o + 2] > 36) this._drops[o + 2] -= 72;
      if (this._drops[o + 2] < -36) this._drops[o + 2] += 72;

      const x = this._drops[o];
      const y = this._drops[o + 1];
      const z = this._drops[o + 2];
      const len = this._drops[o + 3];
      const i6 = i * 6;
      arr[i6] = x;
      arr[i6 + 1] = y;
      arr[i6 + 2] = z;
      arr[i6 + 3] = x - windX * 0.035;
      arr[i6 + 4] = y + len;
      arr[i6 + 5] = z - windZ * 0.035;
    }
    this._posAttr.needsUpdate = true;
  }
}
