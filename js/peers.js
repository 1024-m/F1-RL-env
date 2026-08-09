/** Remote racers — placeholder meshes until car GLBs land in assets/cars/. */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class PeerManager {
  constructor(scene) {
    this.scene = scene;
    this.peers = new Map(); // username -> { mesh, side, targetPos, targetYaw }
    this._loader = new GLTFLoader();
  }

  async _tryLoadCar(entry, carId) {
    try {
      const gltf = await this._loader.loadAsync(`assets/cars/${carId}.glb`);
      const model = gltf.scene;
      model.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      const TARGET_LEN = 4.6;
      let box = new THREE.Box3().setFromObject(model);
      let size = box.getSize(new THREE.Vector3());
      const longest = Math.max(size.x, size.y, size.z, 1e-6);
      model.scale.setScalar(TARGET_LEN / longest);
      model.updateMatrixWorld(true);
      box = new THREE.Box3().setFromObject(model);
      size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      model.position.sub(center);
      model.position.y += size.y / 2;
      const old = entry.mesh;
      const wrap = new THREE.Group();
      wrap.add(model);
      wrap.position.copy(old.position);
      wrap.rotation.y = old.rotation.y;
      this.scene.add(wrap);
      this.scene.remove(old);
      old.geometry?.dispose?.();
      old.material?.dispose?.();
      entry.mesh = wrap;
    } catch {
      // keep box placeholder
    }
  }

  syncPlayers(players, hideUsername = null) {
    const keep = new Set();
    for (const p of players || []) {
      if (!p?.username || p.username === hideUsername) continue;
      keep.add(p.username);
      let entry = this.peers.get(p.username);
      if (!entry) {
        // Temporary until GLB loads — keep tiny so it is never mistaken for the player car.
      const color = 0x444444;
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(0.2, 0.2, 0.2),
          new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.45 }),
        );
        mesh.castShadow = true;
        mesh.position.set(0, 0.35, 0);
        this.scene.add(mesh);
        entry = {
          mesh,
          side: 'ffa',
          carId: p.carId || null,
          targetPos: new THREE.Vector3(),
          targetYaw: 0,
          speed: 0,
        };
        this.peers.set(p.username, entry);
        if (p.carId) this._tryLoadCar(entry, p.carId);
      } else {
        entry.side = 'ffa';
        if (p.carId && p.carId !== entry.carId) {
          entry.carId = p.carId;
          this._tryLoadCar(entry, p.carId);
        }
      }
    }
    for (const [user, entry] of [...this.peers.entries()]) {
      if (!keep.has(user)) {
        this.scene.remove(entry.mesh);
        entry.mesh.geometry?.dispose?.();
        entry.mesh.material?.dispose?.();
        this.peers.delete(user);
      }
    }
  }

  applyState(username, msg) {
    const entry = this.peers.get(username);
    if (!entry || !msg?.pos) return;
    entry.targetPos.set(msg.pos[0], msg.pos[1], msg.pos[2]);
    entry.targetYaw = Array.isArray(msg.rot) ? msg.rot[0] : 0;
    entry.speed = typeof msg.speed === 'number' ? msg.speed : entry.speed;
    entry.mesh.visible = true;
  }

  update(delta) {
    const t = Math.min(1, delta * 12);
    for (const entry of this.peers.values()) {
      entry.mesh.position.lerp(entry.targetPos, t);
      entry.mesh.rotation.y = THREE.MathUtils.lerp(entry.mesh.rotation.y, entry.targetYaw, t);
    }
  }

  clear() {
    for (const entry of this.peers.values()) {
      this.scene.remove(entry.mesh);
      entry.mesh.geometry?.dispose?.();
      entry.mesh.material?.dispose?.();
    }
    this.peers.clear();
  }

  list() {
    return [...this.peers.keys()];
  }

  get(username) {
    return this.peers.get(username) || null;
  }
}
