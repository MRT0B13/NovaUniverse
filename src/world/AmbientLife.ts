import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// ── Constants ─────────────────────────────────────────────────────────────────
const GROUND_Y = 0;
const NPC_SPEED = 0.8;           // units/sec
const CAR_SPEED  = 2.5;          // units/sec
const WANDER_RADIUS = 26;        // NPCs stay within this radius

// ── NPC character models (ones NOT used by agents) ────────────────────────────
const NPC_CHARS = [
  'character-d', 'character-f', 'character-h', 'character-j',
  'character-l', 'character-m', 'character-n', 'character-o',
  'character-p', 'character-q', 'character-r',
];

// ── Ambient car models ────────────────────────────────────────────────────────
const AMBIENT_CARS = [
  'delivery', 'firetruck', 'garbage-truck', 'hatchback-sports',
  'race', 'sedan-sports', 'tractor', 'truck-flat',
];

// ── Road paths for ambient traffic ────────────────────────────────────────────
const TRAFFIC_ROUTES: THREE.Vector3[][] = [
  // Horizontal road (full span)
  [new THREE.Vector3(-28, GROUND_Y, -0.6), new THREE.Vector3(28, GROUND_Y, -0.6)],
  [new THREE.Vector3(28, GROUND_Y, 0.6), new THREE.Vector3(-28, GROUND_Y, 0.6)],
  // Vertical road (full span)
  [new THREE.Vector3(-0.6, GROUND_Y, -28), new THREE.Vector3(-0.6, GROUND_Y, 28)],
  [new THREE.Vector3(0.6, GROUND_Y, 28), new THREE.Vector3(0.6, GROUND_Y, -28)],
];

// ── Sidewalk paths for NPCs ──────────────────────────────────────────────────
const SIDEWALK_PATHS: THREE.Vector3[][] = [
  // Parallel to horizontal road
  [new THREE.Vector3(-25, GROUND_Y, -2.0), new THREE.Vector3(25, GROUND_Y, -2.0)],
  [new THREE.Vector3(25, GROUND_Y, 2.0), new THREE.Vector3(-25, GROUND_Y, 2.0)],
  // Parallel to vertical road
  [new THREE.Vector3(-2.0, GROUND_Y, -25), new THREE.Vector3(-2.0, GROUND_Y, 25)],
  [new THREE.Vector3(2.0, GROUND_Y, 25), new THREE.Vector3(2.0, GROUND_Y, -25)],
  // Diagonal cross paths
  [new THREE.Vector3(-15, GROUND_Y, -15), new THREE.Vector3(15, GROUND_Y, 15)],
  [new THREE.Vector3(15, GROUND_Y, -15), new THREE.Vector3(-15, GROUND_Y, 15)],
];

// ── Helper: seeded random ─────────────────────────────────────────────────────
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── NPC entity ────────────────────────────────────────────────────────────────
interface NPCEntity {
  model: THREE.Object3D;
  target: THREE.Vector3;
  speed: number;
  pathIndex: number;        // which sidewalk path
  pathProgress: number;     // 0..1 along current segment
  direction: 1 | -1;        // forward or backward on path
  idleTimer: number;        // seconds remaining in idle pause
}

// ── Traffic entity ────────────────────────────────────────────────────────────
interface TrafficEntity {
  model: THREE.Object3D;
  routeIndex: number;
  progress: number;         // 0..1 along route
  speed: number;
  respawnDelay: number;
}

// ── Smoke particle system ─────────────────────────────────────────────────────
interface SmokeColumn {
  particles: THREE.Points;
  velocities: Float32Array;
  origin: THREE.Vector3;
  life: Float32Array;
}

// ════════════════════════════════════════════════════════════════════════════════
//  AmbientLife — NPCs, traffic, smoke, ambient atmosphere
// ════════════════════════════════════════════════════════════════════════════════
export class AmbientLife {
  private scene: THREE.Scene;
  private loader: GLTFLoader;
  private texLoader: THREE.TextureLoader;
  private rng: () => number;

  private npcs: NPCEntity[] = [];
  private traffic: TrafficEntity[] = [];
  private smokeCols: SmokeColumn[] = [];

  // GLB cache
  private cache = new Map<string, THREE.Object3D>();

  constructor(scene: THREE.Scene, loader: GLTFLoader, texLoader: THREE.TextureLoader, seed = 137) {
    this.scene = scene;
    this.loader = loader;
    this.texLoader = texLoader;
    this.rng = mulberry32(seed);
  }

  // ── GLB loader with cache ──────────────────────────────────────────────────
  private async loadModel(dir: string, file: string, colormap?: THREE.Texture | null): Promise<THREE.Object3D | null> {
    const key = dir + '/' + file;
    if (this.cache.has(key)) return this.cache.get(key)!.clone();
    try {
      const gltf = await this.loader.loadAsync('/kenney/models/' + key + '.glb');
      const model = gltf.scene;
      model.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          if (colormap) {
            const mat = child.material as THREE.MeshStandardMaterial;
            if (!mat.map) mat.map = colormap;
            mat.needsUpdate = true;
          }
        }
      });
      this.cache.set(key, model);
      return model.clone();
    } catch { return null; }
  }

  // ── Spawn all ambient life ─────────────────────────────────────────────────
  async spawn(): Promise<void> {
    console.log('[AmbientLife] Spawning NPCs and traffic…');

    await this.spawnNPCs();
    await this.spawnTraffic();
    this.createSmoke([]);  // will be called again with chimney positions

    console.log('[AmbientLife] Spawned', this.npcs.length, 'NPCs,', this.traffic.length, 'traffic vehicles');
  }

  // ── Spawn chimney smoke (called after CityPopulator) ───────────────────────
  createSmoke(chimneyPositions: THREE.Vector3[]) {
    // Clean old smoke
    for (const s of this.smokeCols) {
      this.scene.remove(s.particles);
      s.particles.geometry.dispose();
      (s.particles.material as THREE.PointsMaterial).dispose();
    }
    this.smokeCols = [];

    for (const origin of chimneyPositions) {
      const count = 20;
      const positions = new Float32Array(count * 3);
      const velocities = new Float32Array(count * 3);
      const life = new Float32Array(count);

      for (let i = 0; i < count; i++) {
        this.resetSmokeParticle(positions, velocities, life, i, origin);
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

      const mat = new THREE.PointsMaterial({
        color: 0x888888,
        size: 0.25,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
      });

      const points = new THREE.Points(geo, mat);
      this.scene.add(points);
      this.smokeCols.push({ particles: points, velocities, origin, life });
    }
  }

  private resetSmokeParticle(pos: Float32Array, vel: Float32Array, life: Float32Array, i: number, origin: THREE.Vector3) {
    const r = this.rng;
    pos[i * 3]     = origin.x + (r() - 0.5) * 0.2;
    pos[i * 3 + 1] = origin.y;
    pos[i * 3 + 2] = origin.z + (r() - 0.5) * 0.2;
    vel[i * 3]     = (r() - 0.5) * 0.01;
    vel[i * 3 + 1] = 0.02 + r() * 0.03;
    vel[i * 3 + 2] = (r() - 0.5) * 0.01;
    life[i] = r();
  }

  // ── Spawn NPC pedestrians ──────────────────────────────────────────────────
  private async spawnNPCs() {
    const r = this.rng;
    const npcCount = 18;

    for (let i = 0; i < npcCount; i++) {
      const charFile = NPC_CHARS[i % NPC_CHARS.length];
      const charLetter = charFile.replace('character-', '');

      let tex: THREE.Texture | null = null;
      try {
        tex = await this.texLoader.loadAsync('/kenney/textures/texture-' + charLetter + '.png');
        tex.flipY = false;
        tex.colorSpace = THREE.SRGBColorSpace;
      } catch { /* fallback: no texture */ }

      const model = await this.loadModel('characters', charFile);
      if (!model) continue;

      // Apply character texture
      if (tex) {
        model.traverse(child => {
          if (child instanceof THREE.Mesh) {
            const mat = child.material as THREE.MeshStandardMaterial;
            mat.map = tex;
            mat.needsUpdate = true;
          }
        });
      }

      model.scale.setScalar(0.7);

      // Pick a random sidewalk path
      const pathIdx = Math.floor(r() * SIDEWALK_PATHS.length);
      const path = SIDEWALK_PATHS[pathIdx];
      const progress = r();
      const pos = new THREE.Vector3().lerpVectors(path[0], path[1], progress);
      model.position.copy(pos);
      this.scene.add(model);

      this.npcs.push({
        model,
        target: pos.clone(),
        speed: NPC_SPEED * (0.6 + r() * 0.8),
        pathIndex: pathIdx,
        pathProgress: progress,
        direction: r() > 0.5 ? 1 : -1,
        idleTimer: 0,
      });
    }
  }

  // ── Spawn ambient traffic ──────────────────────────────────────────────────
  private async spawnTraffic() {
    const r = this.rng;

    let carsColormap: THREE.Texture | null = null;
    try {
      carsColormap = await this.texLoader.loadAsync('/kenney/textures/cars_colormap.png');
      carsColormap.flipY = false;
      carsColormap.colorSpace = THREE.SRGBColorSpace;
    } catch { /* no colormap */ }

    const carCount = 12;
    for (let i = 0; i < carCount; i++) {
      const carFile = AMBIENT_CARS[i % AMBIENT_CARS.length];
      const model = await this.loadModel('cars', carFile, carsColormap);
      if (!model) continue;

      model.scale.setScalar(0.8);

      const routeIdx = i % TRAFFIC_ROUTES.length;
      const progress = r();
      const route = TRAFFIC_ROUTES[routeIdx];
      const pos = new THREE.Vector3().lerpVectors(route[0], route[1], progress);
      model.position.copy(pos);

      // Face direction of travel
      const dir = new THREE.Vector3().subVectors(route[1], route[0]).normalize();
      model.lookAt(model.position.clone().add(dir));

      this.scene.add(model);

      this.traffic.push({
        model,
        routeIndex: routeIdx,
        progress,
        speed: CAR_SPEED * (0.7 + r() * 0.6),
        respawnDelay: 0,
      });
    }
  }

  // ── Tick (called every frame) ──────────────────────────────────────────────
  tick(delta: number) {
    this.tickNPCs(delta);
    this.tickTraffic(delta);
    this.tickSmoke(delta);
  }

  // ── NPC movement ───────────────────────────────────────────────────────────
  private tickNPCs(delta: number) {
    for (const npc of this.npcs) {
      // Idle pause
      if (npc.idleTimer > 0) {
        npc.idleTimer -= delta;
        // Bob slightly while idle
        npc.model.position.y = GROUND_Y + Math.sin(Date.now() * 0.003) * 0.02;
        continue;
      }

      const path = SIDEWALK_PATHS[npc.pathIndex];
      const pathLen = new THREE.Vector3().subVectors(path[1], path[0]).length();
      const step = (npc.speed * delta) / pathLen;

      npc.pathProgress += step * npc.direction;

      // Reached end of path — pause, then reverse or pick new path
      if (npc.pathProgress >= 1 || npc.pathProgress <= 0) {
        npc.pathProgress = THREE.MathUtils.clamp(npc.pathProgress, 0, 1);
        npc.idleTimer = 1 + this.rng() * 4; // pause 1-5 seconds

        // 40% chance to switch to a new path
        if (this.rng() < 0.4) {
          npc.pathIndex = Math.floor(this.rng() * SIDEWALK_PATHS.length);
          npc.pathProgress = this.rng() > 0.5 ? 0 : 1;
        }
        npc.direction = npc.direction === 1 ? -1 : 1;
        continue;
      }

      // Interpolate position along path
      const pos = new THREE.Vector3().lerpVectors(path[0], path[1], npc.pathProgress);
      npc.model.position.copy(pos);
      npc.model.position.y = GROUND_Y;

      // Face direction of movement
      const fwd = new THREE.Vector3().subVectors(path[1], path[0]).normalize();
      if (npc.direction === -1) fwd.negate();
      npc.model.lookAt(npc.model.position.clone().add(fwd));
    }
  }

  // ── Traffic movement ───────────────────────────────────────────────────────
  private tickTraffic(delta: number) {
    for (const car of this.traffic) {
      if (car.respawnDelay > 0) {
        car.respawnDelay -= delta;
        if (car.respawnDelay <= 0) {
          car.progress = 0;
          car.model.visible = true;
        }
        continue;
      }

      const route = TRAFFIC_ROUTES[car.routeIndex];
      const routeLen = new THREE.Vector3().subVectors(route[1], route[0]).length();
      const step = (car.speed * delta) / routeLen;

      car.progress += step;

      if (car.progress >= 1) {
        // Reached end — hide, wait, respawn at start
        car.model.visible = false;
        car.respawnDelay = 2 + this.rng() * 5;
        continue;
      }

      const pos = new THREE.Vector3().lerpVectors(route[0], route[1], car.progress);
      car.model.position.copy(pos);
    }
  }

  // ── Smoke particles ────────────────────────────────────────────────────────
  private tickSmoke(delta: number) {
    for (const col of this.smokeCols) {
      const pos = col.particles.geometry.attributes.position.array as Float32Array;
      const count = col.life.length;

      for (let i = 0; i < count; i++) {
        col.life[i] += delta * 0.3;

        if (col.life[i] >= 1) {
          this.resetSmokeParticle(pos, col.velocities, col.life, i, col.origin);
          continue;
        }

        pos[i * 3]     += col.velocities[i * 3]     * delta * 30;
        pos[i * 3 + 1] += col.velocities[i * 3 + 1] * delta * 30;
        pos[i * 3 + 2] += col.velocities[i * 3 + 2] * delta * 30;
      }

      col.particles.geometry.attributes.position.needsUpdate = true;
      (col.particles.material as THREE.PointsMaterial).opacity = 0.25;
    }
  }
}
