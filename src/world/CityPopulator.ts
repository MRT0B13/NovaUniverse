import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ZONES, WORLD_WIDTH, WORLD_HEIGHT } from '../config/constants';

// ── Constants ─────────────────────────────────────────────────────────────────
const SCALE   = 0.01;
const WORLD_CX = (WORLD_WIDTH  * SCALE) / 2;   // ~12
const WORLD_CZ = (WORLD_HEIGHT * SCALE) / 2;   // ~9
const BLOCK    = 4;        // city-block size (units)
const HALF     = BLOCK / 2;
const GRID_MIN = -28;
const GRID_MAX = 28;
const ROAD_HALF_W = 1.2;  // road corridor half-width (avoid placing on roads)

// ── Seeded PRNG (mulberry32) ──────────────────────────────────────────────────
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Model catalogues ──────────────────────────────────────────────────────────
const COMMERCIAL_BUILDINGS = [
  'building-a','building-b','building-c','building-d','building-e','building-f',
  'building-g','building-h','building-i','building-j','building-k','building-l',
  'building-m','building-n',
  'building-skyscraper-a','building-skyscraper-b','building-skyscraper-c',
  'building-skyscraper-d','building-skyscraper-e',
  'low-detail-building-a','low-detail-building-b','low-detail-building-c',
  'low-detail-building-d','low-detail-building-e','low-detail-building-f',
  'low-detail-building-g','low-detail-building-h','low-detail-building-i',
  'low-detail-building-j','low-detail-building-k','low-detail-building-l',
  'low-detail-building-m','low-detail-building-n',
  'low-detail-building-wide-a','low-detail-building-wide-b',
];

const INDUSTRIAL_BUILDINGS = [
  'building-a','building-b','building-c','building-d','building-e','building-f',
  'building-g','building-h','building-i','building-j','building-k','building-l',
  'building-m','building-n','building-o','building-p','building-q','building-r',
  'building-s','building-t',
  'chimney-basic','chimney-large','chimney-medium','chimney-small',
  'detail-tank',
];

const SUBURBAN_BUILDINGS = [
  'building-type-a','building-type-b','building-type-c','building-type-d',
  'building-type-e','building-type-f','building-type-g','building-type-h',
  'building-type-i','building-type-j','building-type-k','building-type-l',
  'building-type-m','building-type-n','building-type-o','building-type-p',
  'building-type-q','building-type-r','building-type-s','building-type-t',
  'building-type-u',
];

const STREET_PROPS = [
  { dir: 'roads', file: 'light-curved' },
  { dir: 'roads', file: 'light-square' },
  { dir: 'roads', file: 'sign-hospital' },
  { dir: 'roads', file: 'sign-stop' },
  { dir: 'roads', file: 'sign-yield' },
  { dir: 'roads', file: 'detail-construction-cone' },
  { dir: 'roads', file: 'detail-construction-closed' },
];

const SUBURBAN_PROPS = [
  { dir: 'suburban', file: 'tree-large' },
  { dir: 'suburban', file: 'tree-small' },
  { dir: 'suburban', file: 'planter' },
  { dir: 'suburban', file: 'fence' },
  { dir: 'suburban', file: 'fence-corner' },
];

const ROAD_DETAIL = [
  'road-straight', 'road-straight-sidewalk', 'road-straight-line',
  'road-bend', 'road-crossing',
];

// ── Zone bounding boxes (Three.js coords) ─────────────────────────────────────
interface BBox { xMin: number; xMax: number; zMin: number; zMax: number; }

function getZoneBoxes(): BBox[] {
  return Object.values(ZONES).map(z => {
    const cx = z.x * SCALE - WORLD_CX;
    const cz = z.y * SCALE - WORLD_CZ;
    const hw = (z.w * SCALE) / 2;
    const hh = (z.h * SCALE) / 2;
    return { xMin: cx - hw - 0.5, xMax: cx + hw + 0.5, zMin: cz - hh - 0.5, zMax: cz + hh + 0.5 };
  });
}

function overlapsZone(x: number, z: number, boxes: BBox[]): boolean {
  return boxes.some(b => x >= b.xMin && x <= b.xMax && z >= b.zMin && z <= b.zMax);
}

function onRoad(x: number, z: number): boolean {
  return Math.abs(x) < ROAD_HALF_W || Math.abs(z) < ROAD_HALF_W;
}

// ── District classification ──────────────────────────────────────────────────
type District = 'downtown' | 'industrial' | 'suburban';

function classifyBlock(x: number, z: number): District {
  const dist = Math.sqrt(x * x + z * z);
  if (dist < 10) return 'downtown';
  if ((x < 0 && z > 0) || (x > 10 && z < -5)) return 'industrial';
  return 'suburban';
}

// ════════════════════════════════════════════════════════════════════════════════
//  CityPopulator — fills the empty grid with buildings, props, lights
// ════════════════════════════════════════════════════════════════════════════════
export class CityPopulator {
  private loader: GLTFLoader;
  private texLoader: THREE.TextureLoader;
  private scene: THREE.Scene;
  private rng: () => number;

  // GLB cache: path → scene clone template
  private cache = new Map<string, THREE.Object3D>();
  // Colormap cache
  private colormaps = new Map<string, THREE.Texture>();

  // Buildings placed (for smoke etc.)
  public chimneyPositions: THREE.Vector3[] = [];

  constructor(scene: THREE.Scene, loader: GLTFLoader, texLoader: THREE.TextureLoader, seed = 42) {
    this.scene = scene;
    this.loader = loader;
    this.texLoader = texLoader;
    this.rng = mulberry32(seed);
  }

  // ── Colormap loader ────────────────────────────────────────────────────────
  private async getColormap(category: string): Promise<THREE.Texture | null> {
    if (this.colormaps.has(category)) return this.colormaps.get(category)!;
    try {
      const tex = await this.texLoader.loadAsync('/kenney/textures/' + category + '_colormap.png');
      tex.flipY = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      this.colormaps.set(category, tex);
      return tex;
    } catch { return null; }
  }

  // ── GLB loader with cache ──────────────────────────────────────────────────
  private async loadModel(dir: string, file: string): Promise<THREE.Object3D | null> {
    const key = dir + '/' + file;
    if (this.cache.has(key)) return this.cache.get(key)!.clone();
    try {
      const gltf = await this.loader.loadAsync('/kenney/models/' + key + '.glb');
      const model = gltf.scene;
      const colormap = await this.getColormap(dir);
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
    } catch {
      return null;
    }
  }

  // ── Place a single model ───────────────────────────────────────────────────
  private placeModel(model: THREE.Object3D, x: number, z: number, scale: number, rotY = 0) {
    model.position.set(x, 0, z);
    model.scale.setScalar(scale);
    model.rotation.y = rotY;
    this.scene.add(model);
  }

  // ── Main populate ──────────────────────────────────────────────────────────
  async populate(onProgress?: (pct: number) => void): Promise<void> {
    console.log('[CityPopulator] Starting city generation…');

    const boxes = getZoneBoxes();
    const blocks: Array<{ x: number; z: number; district: District }> = [];

    // Gather all placeable blocks
    for (let bx = GRID_MIN; bx <= GRID_MAX; bx += BLOCK) {
      for (let bz = GRID_MIN; bz <= GRID_MAX; bz += BLOCK) {
        const cx = bx + HALF;
        const cz = bz + HALF;
        if (overlapsZone(cx, cz, boxes)) continue;
        if (onRoad(cx, cz)) continue;
        blocks.push({ x: cx, z: cz, district: classifyBlock(cx, cz) });
      }
    }

    console.log('[CityPopulator] Blocks to fill:', blocks.length);

    let done = 0;
    const total = blocks.length;

    for (const block of blocks) {
      await this.fillBlock(block.x, block.z, block.district, boxes);
      done++;
      if (done % 10 === 0) onProgress?.(Math.round((done / total) * 100));
    }

    // Streetlights along roads
    await this.placeStreetlights();

    // Scatter road-side props
    await this.placeRoadProps(boxes);

    console.log('[CityPopulator] City generation complete — placed', done, 'blocks');
  }

  // ── Fill a single city block ───────────────────────────────────────────────
  private async fillBlock(cx: number, cz: number, district: District, boxes: BBox[]) {
    const r = this.rng;

    // Chance to leave block as empty lot / park
    if (r() < 0.12) {
      // Empty lot — place a few trees / planters
      const count = 1 + Math.floor(r() * 3);
      for (let i = 0; i < count; i++) {
        const px = cx + (r() - 0.5) * BLOCK * 0.7;
        const pz = cz + (r() - 0.5) * BLOCK * 0.7;
        if (overlapsZone(px, pz, boxes) || onRoad(px, pz)) continue;
        const prop = SUBURBAN_PROPS[Math.floor(r() * SUBURBAN_PROPS.length)];
        const model = await this.loadModel(prop.dir, prop.file);
        if (model) this.placeModel(model, px, pz, 0.6 + r() * 0.3, r() * Math.PI * 2);
      }
      return;
    }

    // Pick building catalogue based on district
    let catalogue: string[];
    let dir: string;
    let scale: number;

    switch (district) {
      case 'downtown':
        catalogue = COMMERCIAL_BUILDINGS;
        dir = 'commercial';
        scale = 1.0 + r() * 0.6;
        break;
      case 'industrial':
        catalogue = INDUSTRIAL_BUILDINGS;
        dir = 'industrial';
        scale = 0.9 + r() * 0.5;
        break;
      default:
        catalogue = SUBURBAN_BUILDINGS;
        dir = 'suburban';
        scale = 0.7 + r() * 0.4;
        break;
    }

    // Place 1-3 buildings per block
    const buildingCount = 1 + Math.floor(r() * 2.5);
    for (let i = 0; i < buildingCount; i++) {
      const file = catalogue[Math.floor(r() * catalogue.length)];
      const offsetX = (r() - 0.5) * BLOCK * 0.6;
      const offsetZ = (r() - 0.5) * BLOCK * 0.6;
      const px = cx + offsetX;
      const pz = cz + offsetZ;

      if (overlapsZone(px, pz, boxes) || onRoad(px, pz)) continue;

      const model = await this.loadModel(dir, file);
      if (model) {
        const rotY = Math.floor(r() * 4) * (Math.PI / 2); // snap to 90° increments
        this.placeModel(model, px, pz, scale, rotY);

        // Track chimneys for smoke effect
        if (file.startsWith('chimney')) {
          this.chimneyPositions.push(new THREE.Vector3(px, scale * 2, pz));
        }
      } else {
        // Fallback procedural building
        this.placeFallbackBlock(px, pz, district, scale);
      }
    }

    // Scatter props around buildings (fences, trees, etc.)
    if (r() < 0.5) {
      const propCount = 1 + Math.floor(r() * 2);
      for (let i = 0; i < propCount; i++) {
        const px = cx + (r() - 0.5) * BLOCK * 0.8;
        const pz = cz + (r() - 0.5) * BLOCK * 0.8;
        if (overlapsZone(px, pz, boxes) || onRoad(px, pz)) continue;

        const prop = SUBURBAN_PROPS[Math.floor(r() * SUBURBAN_PROPS.length)];
        const model = await this.loadModel(prop.dir, prop.file);
        if (model) this.placeModel(model, px, pz, 0.5 + r() * 0.3, r() * Math.PI * 2);
      }
    }
  }

  // ── Fallback procedural block ──────────────────────────────────────────────
  private placeFallbackBlock(x: number, z: number, district: District, scale: number) {
    const colors: Record<District, number> = {
      downtown:   0x334455,
      industrial: 0x443322,
      suburban:   0x335544,
    };
    const height = scale * (0.5 + this.rng() * 1.2);
    const w = 0.4 + this.rng() * 0.5;
    const d = 0.4 + this.rng() * 0.5;
    const geo = new THREE.BoxGeometry(w, height, d);
    const mat = new THREE.MeshLambertMaterial({ color: colors[district] });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, height / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  // ── Streetlights along roads ───────────────────────────────────────────────
  private async placeStreetlights() {
    const lightModels = ['light-curved', 'light-square'];
    const spacing = 6;

    // Along horizontal road (z=0, both sides)
    for (let x = GRID_MIN; x <= GRID_MAX; x += spacing) {
      if (Math.abs(x) < 2) continue; // skip intersection
      for (const side of [-1.8, 1.8]) {
        const file = lightModels[Math.abs(x) % 2];
        const model = await this.loadModel('roads', file);
        if (model) {
          const rotY = side > 0 ? 0 : Math.PI;
          this.placeModel(model, x, side, 0.8, rotY);

          // Add actual point light
          const pl = new THREE.PointLight(0xffe8aa, 0.4, 6);
          pl.position.set(x, 2.5, side);
          this.scene.add(pl);
        }
      }
    }

    // Along vertical road (x=0, both sides)
    for (let z = GRID_MIN; z <= GRID_MAX; z += spacing) {
      if (Math.abs(z) < 2) continue;
      for (const side of [-1.8, 1.8]) {
        const file = lightModels[Math.abs(z) % 2];
        const model = await this.loadModel('roads', file);
        if (model) {
          const rotY = side > 0 ? Math.PI / 2 : -Math.PI / 2;
          this.placeModel(model, side, z, 0.8, rotY);

          const pl = new THREE.PointLight(0xffe8aa, 0.3, 5);
          pl.position.set(side, 2.5, z);
          this.scene.add(pl);
        }
      }
    }

    console.log('[CityPopulator] Streetlights placed');
  }

  // ── Road-side props (signs, cones, etc.) ───────────────────────────────────
  private async placeRoadProps(boxes: BBox[]) {
    const r = this.rng;

    // Scatter props along roads
    for (let x = GRID_MIN; x <= GRID_MAX; x += 8) {
      for (const z of [-2.5, 2.5]) {
        if (r() < 0.6) continue; // sparse
        if (overlapsZone(x, z, boxes)) continue;
        const prop = STREET_PROPS[Math.floor(r() * STREET_PROPS.length)];
        const model = await this.loadModel(prop.dir, prop.file);
        if (model) this.placeModel(model, x, z, 0.7, r() * Math.PI * 2);
      }
    }

    for (let z = GRID_MIN; z <= GRID_MAX; z += 8) {
      for (const x of [-2.5, 2.5]) {
        if (r() < 0.6) continue;
        if (overlapsZone(x, z, boxes)) continue;
        const prop = STREET_PROPS[Math.floor(r() * STREET_PROPS.length)];
        const model = await this.loadModel(prop.dir, prop.file);
        if (model) this.placeModel(model, x, z, 0.7, r() * Math.PI * 2);
      }
    }

    console.log('[CityPopulator] Road props placed');
  }
}
