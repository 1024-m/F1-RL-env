import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GameMenu } from './ui-menu.js';
import { NetClient } from './net.js';
import { DriveControls } from './controls.js';
import { LocalCar } from './vehicles.js';
import { Track } from './track.js';
import { CollisionSystem } from './collision.js';
import { RaceAudio } from './audio.js';
import { DEFAULT_CAR, CAR_LABELS } from './cars.js';
import { Weather } from './weather.js';
import {
  CricketFloodlights,
  buildNightSky,
  applyNightLighting,
} from './floodlights.js';
import { MwSpeedo } from './speedo.js';

const SPACE_URL = 'https://1024m-hf-racing.hf.space';

const footer = document.getElementById('footer-text');
const hud = document.getElementById('hud');
const playerHud = document.getElementById('player-hud');
const playerName = document.getElementById('player-name');
const playerAvatar = document.getElementById('player-avatar');
const spectateBar = document.getElementById('spectate-bar');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060a);
scene.fog = new THREE.Fog(0x0c1018, 60, 520);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.2, 2500);
camera.position.set(-95, 1.5, 378.9);
camera.lookAt(-140, -3.16, 378.9);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
renderer.domElement.id = 'game-canvas';
document.body.prepend(renderer.domElement);

{
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
}

const ambient = new THREE.AmbientLight(0x243044, 0.16);
const hemi = new THREE.HemisphereLight(0x3a4a62, 0x080706, 0.2);
scene.add(ambient);
scene.add(hemi);

// Weak moonlight only — asphalt lit by cricket flood banks.
const sun = new THREE.DirectionalLight(0x6a7a99, 0.06);
sun.position.set(40, 120, -60);
sun.castShadow = false;
scene.add(sun);
scene.add(sun.target);

applyNightLighting(scene, renderer, { ambient, hemi, sun });
const nightSky = buildNightSky(scene);
const weather = new Weather(scene);
const floodlights = new CricketFloodlights(scene);

// Tight bloom: only near-emissive LED cores, not snow / white seats / curbs.
const bloomComposer = new EffectComposer(renderer);
bloomComposer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.35,
  0.2,
  0.98, // only true light cores bloom — not snow/seats
);
bloomComposer.addPass(bloomPass);
bloomComposer.addPass(new OutputPass());

const track = new Track(scene);
const collision = new CollisionSystem();
const audio = new RaceAudio();
const controls = new DriveControls();

let car = null;
let inRace = false;
let raceReady = false; // true only after map+car placed — driving gated on this
let spectating = false;
let specIndex = 0;
let trackReady = null;
let enterGen = 0; // ignore stale enterRace completions
let raceMode = 'sandbox';
const speedo = new MwSpeedo(hud);
speedo.setVisible(false);

const loadOverlay = document.createElement('div');
loadOverlay.id = 'load-overlay';
loadOverlay.style.cssText = [
  'position:fixed', 'inset:0', 'z-index:40',
  'display:none', 'flex-direction:column', 'align-items:center', 'justify-content:center',
  'background:rgba(8,6,6,0.88)', 'color:#fff',
  'font:600 1.1rem system-ui,sans-serif', 'letter-spacing:0.02em',
  'pointer-events:none',
].join(';');
loadOverlay.innerHTML = '<div id="load-overlay-msg">Loading…</div><div id="load-overlay-sub" style="margin-top:10px;opacity:0.7;font-weight:500;font-size:0.9rem"></div>';
document.body.appendChild(loadOverlay);
const loadMsg = () => document.getElementById('load-overlay-msg');
const loadSub = () => document.getElementById('load-overlay-sub');

function showLoading(title, sub = '') {
  loadOverlay.style.display = 'flex';
  loadOverlay.style.pointerEvents = 'all';
  if (loadMsg()) loadMsg().textContent = title;
  if (loadSub()) loadSub().textContent = sub;
  if (footer) footer.textContent = sub || title;
}

function hideLoading() {
  loadOverlay.style.display = 'none';
  loadOverlay.style.pointerEvents = 'none';
}

function updateNightFollow(target) {
  if (!target?.position) return;
  sun.position.set(target.position.x + 40, target.position.y + 120, target.position.z - 60);
  sun.target.position.copy(target.position);
  sun.target.updateMatrixWorld();
  floodlights.update(target.position);
}

const net = new NetClient({
  scene,
  onStatus: (msg) => {
    // Never overwrite load progress with WS noise.
    if (raceReady || !inRace) {
      if (footer) footer.textContent = msg;
    }
  },
  onLobbyUpdate: (board, mode, err) => menu.renderBoard(board, mode, err),
  onMatchStart: enterRace,
  onMatchEnd: () => { if (footer) footer.textContent = 'Race finished — Esc for menu'; },
  onMatchConnectionLost: () => {
    // Sandbox is local-play — WS death must not dump to lobby.
    if (raceMode === 'sandbox' || !raceReady) {
      if (footer && raceReady) footer.textContent = 'Offline (sandbox still playable) — Esc for menu';
      return;
    }
    leaveRaceToMenu(true);
  },
});

const menu = new GameMenu({
  root: document.getElementById('menu-root'),
  onOpenMode: (mode) => net.startLobbyPoll(mode),
  onBack: async () => {
    net.stopLobbyPoll();
    await net.leaveLobby();
  },
  onClaim: async (mode, lobbyId, seat) => {
    const pick = menu.getSelectedCar();
    const data = await net.claim(mode, lobbyId, seat, pick);
    if (mode === 'sandbox') {
      // Start sandbox immediately on claim — do not wait on flaky remote WS.
      showLoading('Starting sandbox…', 'Waiting for map + car');
      net.connectMatch(); // optional peers; gameplay does not depend on it
      enterRace({
        mode: 'sandbox',
        carId: data?.carId || pick || DEFAULT_CAR,
        spawnIndex: 0,
        spectating: false,
        localSolo: true,
      });
      return data;
    }
    if (data?.started || data?.matchId) {
      if (footer) footer.textContent = 'Starting race…';
      net.connectMatch();
    }
    return data;
  },
  onLeaveSeat: () => net.leaveLobby(),
  onEnterMatch: () => net.connectMatch(),
  onSpectate: (mode, lobbyId) => {
    menu.hide();
    hud.hidden = false;
    net.connectSpectate(mode, lobbyId);
  },
});

function setIdentityHud(identity) {
  if (!identity?.username) return;
  if (playerName) playerName.textContent = identity.username;
  if (playerAvatar && identity.avatarUrl) {
    playerAvatar.src = identity.avatarUrl;
    playerAvatar.hidden = false;
  }
  if (playerHud) playerHud.hidden = false;
}

async function ensureTrack() {
  if (!trackReady) {
    trackReady = track.loadShanghai((p, phase) => {
      const pct = Math.round(p * 100);
      let sub;
      if (phase === 'parse') sub = 'Parsing Shanghai GLB…';
      else if (phase === 'build') sub = 'Building track…';
      else if (phase === 'done') sub = 'Map ready';
      else if (phase === 'error') sub = 'Map failed';
      else sub = `Shanghai map ${pct}%`;
      if (inRace && !raceReady) showLoading('Loading track…', sub);
      else if (footer) footer.textContent = sub;
    });
  }
  return trackReady;
}

async function enterRace(info) {
  // Deduplicate sandbox claim + match_start.
  if (inRace) return;

  const gen = ++enterGen;
  raceMode = info?.mode || net.mode || 'sandbox';
  inRace = true;
  raceReady = false;
  spectating = !!info.spectating;
  menu.hide();
  hud.hidden = false;
  if (spectateBar) spectateBar.hidden = !spectating;
  speedo.setVisible(true);
  speedo.update({ speedKmh: 0, rpm: 900, gear: 1, throttle: 0 });
  showLoading('Loading race…', 'Do not leave — map is large');

  // Dispose any half-spawned car so frame loop cannot drive an empty root at origin.
  if (car) {
    car.dispose();
    car = null;
  }

  try {
    await audio.ensure().catch(() => {});

    showLoading('Loading Shanghai map…', '0%');
    let mapOk = false;
    try {
      mapOk = await ensureTrack();
    } catch (err) {
      console.error(err);
      mapOk = false;
    }
    if (gen !== enterGen) return;

    if (!mapOk || !track.ready) {
      showLoading('Map failed', 'assets/maps/shanghai/track.glb');
      await new Promise((r) => setTimeout(r, 1500));
      leaveRaceToMenu(true);
      return;
    }

    weather.applyWet(track.ground.concat(track.terrain));
    showLoading('Installing floodlights…', 'Cricket masts along the racing line');
    await floodlights.install(track.ground);
    if (gen !== enterGen) return;

    const grid = track.getGridPose(info.spawnIndex || 0);
    // Keep track yaw (asphalt heading). Do NOT force -PI/2 — that aims diagonal to the road.

    if (!spectating) {
      const carId = info.carId || DEFAULT_CAR;
      showLoading('Loading car…', CAR_LABELS[carId] || carId);
      const next = new LocalCar(scene);
      let loadedId = carId;
      try {
        loadedId = await next.loadModel(carId);
      } catch (err) {
        console.error('car load failed', err);
        next.dispose();
        const detail = err?.message || String(carId);
        showLoading('Car failed to load', detail.slice(0, 180));
        await new Promise((r) => setTimeout(r, 2500));
        leaveRaceToMenu(true);
        return;
      }
      if (gen !== enterGen) {
        next.dispose();
        return;
      }

      // On-grid start: X front of boxes, Z on racing line (~370), NOT pit (~344).
      let x = grid.x;
      let z = grid.z;
      let y = grid.y;
      if (track.ground.length) {
        // Prefer ground near calibrated asphalt height (−3.1).
        let g = collision.groundAt(track.ground, x, z, 40, -3.1);
        if (!g) {
          for (const [dx, dz] of [
            [0, 0], [2, 0], [-2, 0], [0, 2], [0, -2], [6, 0], [0, -4], [0, 4],
          ]) {
            g = collision.groundAt(track.ground, x + dx, z + dz, 40, -3.1);
            if (g) {
              x += dx;
              z += dz;
              break;
            }
          }
        }
        if (g) y = g.y + 0.12;
      }
      next.setPose(x, y, z, grid.yaw);
      car = next;
      floodlights.bindCar(car.root);
      snapChaseCam(car);

      const label = CAR_LABELS[loadedId] || loadedId;
      if (footer) {
        footer.textContent = `${label} · grid (${x.toFixed(0)}, ${y.toFixed(1)}, ${z.toFixed(0)}) · yaw ${(grid.yaw * 180 / Math.PI).toFixed(0)}°`;
      }
    }

    if (gen !== enterGen) return;
    raceReady = true;
    hideLoading();
    controls.enable();
    renderer.domElement.tabIndex = 0;
    renderer.domElement.focus({ preventScroll: true });
    if (footer && !spectating) {
      const label = car ? (CAR_LABELS[car.modelId] || car.modelId) : '';
        footer.textContent = `${label} · W gas · S/↓/Space brake · Esc`;
    }
  } catch (err) {
    console.error(err);
    if (gen === enterGen) {
      showLoading('Race start failed', String(err?.message || err));
      await new Promise((r) => setTimeout(r, 1200));
      leaveRaceToMenu(true);
    }
  }
}

function loadingLocked() {
  return inRace && !raceReady;
}

function leaveRaceToMenu(force = false) {
  if (loadingLocked() && !force) return;
  enterGen += 1;
  inRace = false;
  raceReady = false;
  spectating = false;
  controls.disable();
  hideLoading();
  net.disconnectMatch();
  audio.stop();
  if (car) {
    car.dispose();
    car = null;
  }
  camReady = false;
  hud.hidden = true;
  speedo.setVisible(false);
  if (spectateBar) spectateBar.hidden = true;
  menu.show();
  net.startLobbyPoll(menu.mode || 'sandbox');
}

document.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && inRace && raceReady) leaveRaceToMenu(true);
});
document.getElementById('spec-prev')?.addEventListener('click', () => { specIndex = Math.max(0, specIndex - 1); });
document.getElementById('spec-next')?.addEventListener('click', () => { specIndex += 1; });
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  bloomComposer.setSize(window.innerWidth, window.innerHeight);
  bloomPass.resolution.set(window.innerWidth, window.innerHeight);
});
window.addEventListener('pointerdown', () => { audio.ensure(); }, { once: true });

let camYaw = 0;
let camLook = new THREE.Vector3();
let camReady = false;

/** Tight third-person chase — sits on the bumper, not a high drone. */
function chaseDesired(target, yaw) {
  const pos = target.position;
  const spd = Math.abs(target.speed || 0);
  const dist = 6.8 + Math.min(3.5, spd * 0.05);
  const height = 2.15 + Math.min(0.7, spd * 0.008);
  const lookAhead = 5.5 + Math.min(4, spd * 0.06);
  return {
    cam: new THREE.Vector3(
      pos.x - Math.sin(yaw) * dist,
      pos.y + height,
      pos.z - Math.cos(yaw) * dist,
    ),
    look: new THREE.Vector3(
      pos.x + Math.sin(yaw) * lookAhead,
      pos.y + 0.85,
      pos.z + Math.cos(yaw) * lookAhead,
    ),
    spd,
  };
}

function snapChaseCam(target) {
  if (!target) return;
  camYaw = target.yaw ?? 0;
  camReady = true;
  const { cam, look, spd } = chaseDesired(target, camYaw);
  camera.position.copy(cam);
  camLook.copy(look);
  camera.fov = 68 + Math.min(10, (spd || 0) * 0.12);
  camera.updateProjectionMatrix();
  camera.lookAt(camLook);
}

function followCar(target, delta) {
  if (!target) return;
  const yaw = target.yaw ?? 0;
  if (!camReady) {
    camYaw = yaw;
    camReady = true;
  }
  // Track the car — slight lag so it feels planted, not a drone / not a whip.
  let dy = yaw - camYaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  camYaw += dy * Math.min(1, delta * 9);

  const { cam, look, spd } = chaseDesired(target, camYaw);
  const wantFov = 68 + Math.min(10, spd * 0.12);
  camera.fov += (wantFov - camera.fov) * Math.min(1, delta * 5);
  camera.updateProjectionMatrix();
  if (camera.position.distanceToSquared(cam) > 25 * 25) camera.position.copy(cam);
  else camera.position.lerp(cam, Math.min(1, delta * 14));
  camLook.lerp(look, Math.min(1, delta * 12));
  camera.lookAt(camLook);
}

let last = performance.now();
function frame(now) {
  const delta = Math.min(0.05, (now - last) / 1000);
  last = now;

  // Drive ONLY when map+car are ready — never move an empty placeholder at origin.
  if (inRace && raceReady && !spectating && car?.loaded) {
    car.update(delta, controls.sample(), {
      resolve: collision.resolve.bind(collision),
      ground: track.ground,
      terrain: track.terrain,
      walls: track.walls,
      barrierBoxes: track.barrierBoxes,
      barrierGrid: track.barrierGrid,
      barrierCellSize: track.barrierCellSize,
      colliders: track.colliders,
    });
    speedo.update({
      speedKmh: car.speedKmh(),
      rpm: car.rpm,
      gear: car.gear,
      reversing: car.reversing,
      throttle: car.throttle,
    });
    followCar(car, delta);
    updateNightFollow(car);
    nightSky.update(delta, car.position);
    weather.update(delta, camera, car.position);
    audio.update({
      speedMps: car.speed,
      throttle: car.throttle,
      brake: car.brake,
      rpm: car.rpm,
      colliding: car.colliding,
    });
    net.update(delta, car);
  } else if (inRace && raceReady && spectating) {
    const names = net.peers.list();
    if (names.length) {
      specIndex = ((specIndex % names.length) + names.length) % names.length;
      const peer = net.peers.get(names[specIndex]);
      if (peer) {
        followCar({ position: peer.mesh.position, yaw: peer.mesh.rotation.y }, delta);
        updateNightFollow({ position: peer.mesh.position });
        nightSky.update(delta, peer.mesh.position);
        weather.update(delta, camera, peer.mesh.position);
        const nameEl = document.getElementById('spec-name');
        if (nameEl) nameEl.textContent = names[specIndex];
      }
    }
  }

  bloomComposer.render();
  requestAnimationFrame(frame);
}

async function boot() {
  hideLoading();
  if (footer) footer.textContent = 'Signing in…';

  let identity = { ok: false, error: 'Signing in…' };
  try {
    identity = await Promise.race([
      net.initLocal(),
      new Promise((resolve) => setTimeout(() => resolve({
        ok: false,
        error: 'Sign-in timed out — check HF_TOKEN / network',
      }), 8000)),
    ]);
  } catch (err) {
    identity = { ok: false, error: String(err?.message || err) };
  }

  if (identity.ok) {
    menu.setIdentity({
      username: identity.username,
      spaceUrl: identity.spaceUrl || SPACE_URL,
      authError: null,
      playAllowed: identity.playAllowed !== false,
    });
    setIdentityHud(identity);
    if (footer) footer.textContent = 'Menu ready — map loads in background';
  } else {
    menu.setIdentity({
      username: null,
      spaceUrl: SPACE_URL,
      authError: identity.error || 'Not signed in — set HF_TOKEN in .env.local',
      playAllowed: false,
    });
    if (footer) footer.textContent = identity.error || 'Set HF_TOKEN in .env.local';
  }

  requestAnimationFrame(frame);

  // Warm the map in the background AFTER the menu has painted.
  await new Promise((r) => setTimeout(r, 100));
  ensureTrack().then((ok) => {
    if (footer && !inRace) {
      footer.textContent = identity.ok
        ? (ok ? `Ready · map loaded · ${SPACE_URL}` : 'Map failed — check assets/maps/shanghai/track.glb')
        : (identity.error || 'Set HF_TOKEN in .env.local');
    }
  }).catch((err) => {
    console.error(err);
    if (footer && !inRace) footer.textContent = `Map error: ${err.message || err}`;
  });
}

boot();
