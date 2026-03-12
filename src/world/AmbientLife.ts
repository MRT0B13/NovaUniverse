import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { STREETS_X, STREETS_Z, ROAD_HW, SIDEWALK_W } from './CityPopulator';

// ── Constants ─────────────────────────────────────────────────────────────────
const GROUND_Y  = 0;
const NPC_SPEED = 1.2;
const CAR_SPEED = 3.5;

// Character models NOT used by named agents
const NPC_CHARS = [
  'character-d','character-f','character-h','character-j',
  'character-l','character-m','character-n','character-o',
  'character-p','character-q','character-r',
];

// Ambient car models
const AMBIENT_CARS = [
  'delivery','firetruck','garbage-truck','hatchback-sports',
  'race','sedan-sports','tractor','truck-flat',
  'sedan','taxi','police','van','suv','ambulance',
];

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Build sidewalk paths from the grid ────────────────────────────────────────
function buildSidewalkPaths(): THREE.Vector3[][] {
  const paths: THREE.Vector3[][] = [];
  const yy = GROUND_Y;
  const sw = ROAD_HW + SIDEWALK_W / 2 + 0.1;

  // Along each horizontal road, walk on both sidewalks
  for (const z of STREETS_Z) {
    paths.push([new THREE.Vector3(-28, yy, z - sw), new THREE.Vector3(28, yy, z - sw)]);
    paths.push([new THREE.Vector3(28, yy, z + sw), new THREE.Vector3(-28, yy, z + sw)]);
  }
  // Along each vertical road
  for (const x of STREETS_X) {
    paths.push([new THREE.Vector3(x - sw, yy, -28), new THREE.Vector3(x - sw, yy, 28)]);
    paths.push([new THREE.Vector3(x + sw, yy, 28), new THREE.Vector3(x + sw, yy, -28)]);
  }
  return paths;
}

// ── Entities ──────────────────────────────────────────────────────────────────
interface NPCEntity {
  model: THREE.Object3D;
  speed: number;
  pathIndex: number;
  pathProgress: number;
  direction: 1 | -1;
  idleTimer: number;
  walkPhase: number;
}

interface TrafficEntity {
  model: THREE.Object3D;
  from: THREE.Vector3;
  to: THREE.Vector3;
  progress: number;
  speed: number;
  respawnDelay: number;
}

interface SmokeColumn {
  particles: THREE.Points;
  velocities: Float32Array;
  origin: THREE.Vector3;
  life: Float32Array;
}

// ════════════════════════════════════════════════════════════════════════════════
//  AmbientLife — NPCs on every sidewalk, cars on every road, chimney smoke
// ════════════════════════════════════════════════════════════════════════════════
export class AmbientLife {
  private scene: THREE.Scene;
  private loader: GLTFLoader;
  private texLoader: THREE.TextureLoader;
  private rng: () => number;

  private npcs: NPCEntity[] = [];
  private traffic: TrafficEntity[] = [];
  private smokeCols: SmokeColumn[] = [];
  private sidewalkPaths: THREE.Vector3[][];

  private cache = new Map<string, THREE.Object3D>();

  constructor(scene: THREE.Scene, loader: GLTFLoader, texLoader: THREE.TextureLoader, seed = 137) {
    this.scene = scene;
    this.loader = loader;
    this.texLoader = texLoader;
    this.rng = mulberry32(seed);
    this.sidewalkPaths = buildSidewalkPaths();
  }

  private async loadModel(dir: string, file: string, colormap?: THREE.Texture | null): Promise<THREE.Object3D | null> {
    const key = dir + '/' + file;
    if (this.cache.has(key)) return this.cache.get(key)!.clone();
    try {
      const gltf = await this.loader.loadAsync('/kenney/models/' + key + '.glb');
      const model = gltf.scene;
      model.traverse(c => {
        if (c instanceof THREE.Mesh) {
          c.castShadow = true; c.receiveShadow = true;
          if (colormap) { const m = c.material as THREE.MeshStandardMaterial; if (!m.map) m.map = colormap; m.needsUpdate = true; }
        }
      });
      this.cache.set(key, model);
      return model.clone();
    } catch { return null; }
  }

  // ── Spawn everything ───────────────────────────────────────────────────────
  async spawn(roadSegments: Array<{ from: THREE.Vector3; to: THREE.Vector3 }>): Promise<void> {
    console.log('[AmbientLife] Spawning…');
    await this.spawnNPCs();
    await this.spawnTraffic(roadSegments);
    console.log('[AmbientLife]', this.npcs.length, 'NPCs,', this.traffic.length, 'cars');
  }

  // ── Chimney smoke ──────────────────────────────────────────────────────────
  createSmoke(origins: THREE.Vector3[]) {
    for (const s of this.smokeCols) {
      this.scene.remove(s.particles);
      s.particles.geometry.dispose();
      (s.particles.material as THREE.PointsMaterial).dispose();
    }
    this.smokeCols = [];

    for (const origin of origins) {
      const count = 16;
      const positions = new Float32Array(count * 3);
      const velocities = new Float32Array(count * 3);
      const life = new Float32Array(count);
      for (let i = 0; i < count; i++) this.resetSmoke(positions, velocities, life, i, origin);

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.PointsMaterial({ color: 0x888888, size: 0.25, transparent: true, opacity: 0.3, depthWrite: false });
      const pts = new THREE.Points(geo, mat);
      this.scene.add(pts);
      this.smokeCols.push({ particles: pts, velocities, origin, life });
    }
  }

  private resetSmoke(pos: Float32Array, vel: Float32Array, life: Float32Array, i: number, o: THREE.Vector3) {
    const r = this.rng;
    pos[i * 3] = o.x + (r() - 0.5) * 0.2;
    pos[i * 3 + 1] = o.y;
    pos[i * 3 + 2] = o.z + (r() - 0.5) * 0.2;
    vel[i * 3] = (r() - 0.5) * 0.01;
    vel[i * 3 + 1] = 0.02 + r() * 0.03;
    vel[i * 3 + 2] = (r() - 0.5) * 0.01;
    life[i] = r();
  }

  // ── NPCs ───────────────────────────────────────────────────────────────────
  private async spawnNPCs() {
    const r = this.rng;
    const NPC_COUNT = 40; // many NPCs across the grid

    for (let i = 0; i < NPC_COUNT; i++) {
      const charFile = NPC_CHARS[i % NPC_CHARS.length];
      const charLetter = charFile.replace('character-', '');

      let tex: THREE.Texture | null = null;
      try {
        tex = await this.texLoader.loadAsync('/kenney/textures/texture-' + charLetter + '.png');
        tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace;
      } catch {}

      const model = await this.loadModel('characters', charFile);
      if (!model) continue;

      if (tex) {
        model.traverse(c => {
          if (c instanceof THREE.Mesh) { const m = c.material as THREE.MeshStandardMaterial; m.map = tex; m.needsUpdate = true; }
        });
      }

      model.scale.setScalar(0.7);

      const pathIdx = Math.floor(r() * this.sidewalkPaths.length);
      const path = this.sidewalkPaths[pathIdx];
      const progress = r();
      const pos = new THREE.Vector3().lerpVectors(path[0], path[1], progress);
      pos.y = GROUND_Y;
      model.position.copy(pos);
      this.scene.add(model);

      this.npcs.push({
        model,
        speed: NPC_SPEED * (0.5 + r() * 1.0),
        pathIndex: pathIdx,
        pathProgress: progress,
        direction: r() > 0.5 ? 1 : -1,
        idleTimer: r() * 3,
        walkPhase: r() * Math.PI * 2,
      });
    }
  }

  // ── Traffic ────────────────────────────────────────────────────────────────
  private async spawnTraffic(segments: Array<{ from: THREE.Vector3; to: THREE.Vector3 }>) {
    const r = this.rng;
    let carsColormap: THREE.Texture | null = null;
    try {
      carsColormap = await this.texLoader.loadAsync('/kenney/textures/cars_colormap.png');
      carsColormap.flipY = false; carsColormap.colorSpace = THREE.SRGBColorSpace;
    } catch {}

    // Place 2-3 cars per road segment (each street has 2 lanes = 2 segments)
    // That's ~28 segments × 2 = ~56 cars total across the grid
    const CAR_COUNT = Math.min(segments.length, 50); // cap for performance

    for (let i = 0; i < CAR_COUNT; i++) {
      const seg = segments[i % segments.length];
      const carFile = AMBIENT_CARS[i % AMBIENT_CARS.length];
      const model = await this.loadModel('cars', carFile, carsColormap);
      if (!model) continue;

      model.scale.setScalar(0.8);
      const progress = r();
      const pos = new THREE.Vector3().lerpVectors(seg.from, seg.to, progress);
      model.position.copy(pos);

      const dir = new THREE.Vector3().subVectors(seg.to, seg.from).normalize();
      model.lookAt(model.position.clone().add(dir));

      this.scene.add(model);
      this.traffic.push({
        model,
        from: seg.from, to: seg.to,
        progress,
        speed: CAR_SPEED * (0.6 + r() * 0.8),
        respawnDelay: 0,
      });
    }
  }

  // ── Tick ────────────────────────────────────────────────────────────────────
  tick(delta: number) {
    this.tickNPCs(delta);
    this.tickTraffic(delta);
    this.tickSmoke(delta);
  }

  private tickNPCs(delta: number) {
    for (const npc of this.npcs) {
      if (npc.idleTimer > 0) {
        npc.idleTimer -= delta;
        npc.model.position.y = GROUND_Y;
        npc.model.rotation.z = Math.sin(npc.walkPhase + performance.now() * 0.001) * 0.01;
        npc.model.rotation.x = 0;
        continue;
      }

      const path = this.sidewalkPaths[npc.pathIndex];
      const pathLen = new THREE.Vector3().subVectors(path[1], path[0]).length();
      const step = (npc.speed * delta) / pathLen;
      npc.pathProgress += step * npc.direction;

      if (npc.pathProgress >= 1 || npc.pathProgress <= 0) {
        npc.pathProgress = THREE.MathUtils.clamp(npc.pathProgress, 0, 1);
        npc.idleTimer = 1 + this.rng() * 3;
        // 50% chance switch to connecting sidewalk
        if (this.rng() < 0.5) {
          npc.pathIndex = Math.floor(this.rng() * this.sidewalkPaths.length);
          npc.pathProgress = this.rng() > 0.5 ? 0 : 1;
        }
        npc.direction = npc.direction === 1 ? -1 : 1;
        continue;
      }

      const pos = new THREE.Vector3().lerpVectors(path[0], path[1], npc.pathProgress);
      npc.model.position.copy(pos);

      const fwd = new THREE.Vector3().subVectors(path[1], path[0]).normalize();
      if (npc.direction === -1) fwd.negate();
      npc.model.lookAt(npc.model.position.clone().add(fwd));

      // Procedural walk
      npc.walkPhase += delta * npc.speed * 8;
      npc.model.position.y = GROUND_Y + Math.abs(Math.sin(npc.walkPhase)) * 0.04;
      npc.model.rotation.z = Math.sin(npc.walkPhase) * 0.05;
      npc.model.rotation.x = Math.sin(npc.walkPhase * 2) * 0.02;
    }
  }

  private tickTraffic(delta: number) {
    for (const car of this.traffic) {
      if (car.respawnDelay > 0) {
        car.respawnDelay -= delta;
        if (car.respawnDelay <= 0) { car.progress = 0; car.model.visible = true; }
        continue;
      }

      const routeLen = new THREE.Vector3().subVectors(car.to, car.from).length();
      car.progress += (car.speed * delta) / routeLen;

      if (car.progress >= 1) {
        car.model.visible = false;
        car.respawnDelay = 1 + this.rng() * 4;
        continue;
      }

      const pos = new THREE.Vector3().lerpVectors(car.from, car.to, car.progress);
      car.model.position.copy(pos);
    }
  }

  private tickSmoke(delta: number) {
    for (const col of this.smokeCols) {
      const pos = col.particles.geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < col.life.length; i++) {
        col.life[i] += delta * 0.3;
        if (col.life[i] >= 1) { this.resetSmoke(pos, col.velocities, col.life, i, col.origin); continue; }
        pos[i * 3]     += col.velocities[i * 3]     * delta * 30;
        pos[i * 3 + 1] += col.velocities[i * 3 + 1] * delta * 30;
        pos[i * 3 + 2] += col.velocities[i * 3 + 2] * delta * 30;
      }
      col.particles.geometry.attributes.position.needsUpdate = true;
    }
  }
}
