import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ZONES, WORLD_WIDTH, WORLD_HEIGHT } from '../config/constants';

// ── Layout Constants ──────────────────────────────────────────────────────────
const SCALE    = 0.01;
const WORLD_CX = (WORLD_WIDTH  * SCALE) / 2;
const WORLD_CZ = (WORLD_HEIGHT * SCALE) / 2;

// Street grid — roads run at these X and Z coordinates
const ROAD_W   = 2.0;
const ROAD_HW  = ROAD_W / 2;
const STREETS_X = [-24, -16, -8, 0, 8, 16, 24];
const STREETS_Z = [-24, -16, -8, 0, 8, 16, 24];
const BLOCK_SIZE = 8;
const SIDEWALK_W = 0.6;

// ── Seeded PRNG ───────────────────────────────────────────────────────────────
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Model catalogues ──────────────────────────────────────────────────────────
const DOWNTOWN = [
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

const INDUSTRIAL = [
  'building-a','building-b','building-c','building-d','building-e','building-f',
  'building-g','building-h','building-i','building-j','building-k','building-l',
  'building-m','building-n','building-o','building-p','building-q','building-r',
  'building-s','building-t',
  'chimney-basic','chimney-large','chimney-medium','chimney-small',
  'detail-tank',
];

const SUBURBAN = [
  'building-type-a','building-type-b','building-type-c','building-type-d',
  'building-type-e','building-type-f','building-type-g','building-type-h',
  'building-type-i','building-type-j','building-type-k','building-type-l',
  'building-type-m','building-type-n','building-type-o','building-type-p',
  'building-type-q','building-type-r','building-type-s','building-type-t',
  'building-type-u',
];

const STREET_FURNITURE = [
  { dir: 'roads', file: 'light-curved' },
  { dir: 'roads', file: 'light-square' },
  { dir: 'roads', file: 'sign-hospital' },
  { dir: 'roads', file: 'sign-stop' },
  { dir: 'roads', file: 'sign-yield' },
];

const VEGETATION = [
  { dir: 'suburban', file: 'tree-large' },
  { dir: 'suburban', file: 'tree-small' },
  { dir: 'suburban', file: 'planter' },
];

// ── Zone boxes ────────────────────────────────────────────────────────────────
interface BBox { xMin: number; xMax: number; zMin: number; zMax: number; }
function getZoneBoxes(): BBox[] {
  return Object.values(ZONES).map(z => {
    const cx = z.x * SCALE - WORLD_CX;
    const cz = z.y * SCALE - WORLD_CZ;
    const hw = (z.w * SCALE) / 2;
    const hh = (z.h * SCALE) / 2;
    return { xMin: cx - hw - 0.3, xMax: cx + hw + 0.3, zMin: cz - hh - 0.3, zMax: cz + hh + 0.3 };
  });
}
function inZone(x: number, z: number, boxes: BBox[]): boolean {
  return boxes.some(b => x >= b.xMin && x <= b.xMax && z >= b.zMin && z <= b.zMax);
}
function onAnyRoad(x: number, z: number): boolean {
  for (const sx of STREETS_X) { if (Math.abs(x - sx) < ROAD_HW + 0.3) return true; }
  for (const sz of STREETS_Z) { if (Math.abs(z - sz) < ROAD_HW + 0.3) return true; }
  return false;
}

type District = 'downtown' | 'industrial' | 'suburban';
function classifyPos(x: number, z: number): District {
  const d = Math.sqrt(x * x + z * z);
  if (d < 12) return 'downtown';
  if ((x < -4 && z > 4) || (x > 12 && z < -4)) return 'industrial';
  return 'suburban';
}

// Street X/Z are exported for AmbientLife
export { STREETS_X, STREETS_Z, ROAD_HW, SIDEWALK_W };

// ════════════════════════════════════════════════════════════════════════════════
//  CityPopulator — proper city grid with streets, blocks, buildings
// ════════════════════════════════════════════════════════════════════════════════
export class CityPopulator {
  private loader: GLTFLoader;
  private texLoader: THREE.TextureLoader;
  private scene: THREE.Scene;
  private rng: () => number;
  private cache = new Map<string, THREE.Object3D>();
  private colormaps = new Map<string, THREE.Texture>();
  public chimneyPositions: THREE.Vector3[] = [];

  /** All road segments for ambient traffic */
  public roadSegments: Array<{ from: THREE.Vector3; to: THREE.Vector3 }> = [];

  constructor(scene: THREE.Scene, loader: GLTFLoader, texLoader: THREE.TextureLoader, seed = 42) {
    this.scene = scene;
    this.loader = loader;
    this.texLoader = texLoader;
    this.rng = mulberry32(seed);
  }

  private async getColormap(cat: string): Promise<THREE.Texture | null> {
    if (this.colormaps.has(cat)) return this.colormaps.get(cat)!;
    try {
      const tex = await this.texLoader.loadAsync('/kenney/textures/' + cat + '_colormap.png');
      tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace;
      this.colormaps.set(cat, tex);
      return tex;
    } catch { return null; }
  }

  private async loadModel(dir: string, file: string): Promise<THREE.Object3D | null> {
    const key = dir + '/' + file;
    if (this.cache.has(key)) return this.cache.get(key)!.clone();
    try {
      const gltf = await this.loader.loadAsync('/kenney/models/' + key + '.glb');
      const model = gltf.scene;
      const cmap = await this.getColormap(dir);
      model.traverse(c => {
        if (c instanceof THREE.Mesh) {
          c.castShadow = true; c.receiveShadow = true;
          if (cmap) { const m = c.material as THREE.MeshStandardMaterial; if (!m.map) m.map = cmap; m.needsUpdate = true; }
        }
      });
      this.cache.set(key, model);
      return model.clone();
    } catch { return null; }
  }

  // ══════════════════════════════════════════════════════════════════════════
  async populate(onProgress?: (pct: number) => void): Promise<void> {
    console.log('[CityPopulator] Building city grid…');
    const zones = getZoneBoxes();

    await this.buildStreetGrid(zones);
    onProgress?.(20);

    await this.fillAllBlocks(zones, onProgress);
    onProgress?.(80);

    await this.placeStreetFurniture(zones);
    onProgress?.(95);

    console.log('[CityPopulator] City complete');
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  Street grid
  // ══════════════════════════════════════════════════════════════════════════
  private async buildStreetGrid(_zones: BBox[]) {
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x2a2d35, roughness: 0.9 });
    const swMat   = new THREE.MeshStandardMaterial({ color: 0x3a3d48, roughness: 0.85 });
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xffee44, transparent: true, opacity: 0.35 });
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.15 });

    // Horizontal roads
    for (const z of STREETS_Z) {
      const road = new THREE.Mesh(new THREE.PlaneGeometry(60, ROAD_W), roadMat);
      road.rotation.x = -Math.PI / 2; road.position.set(0, 0.015, z);
      road.receiveShadow = true; this.scene.add(road);

      for (const off of [-(ROAD_HW + SIDEWALK_W / 2), ROAD_HW + SIDEWALK_W / 2]) {
        const sw = new THREE.Mesh(new THREE.PlaneGeometry(60, SIDEWALK_W), swMat);
        sw.rotation.x = -Math.PI / 2; sw.position.set(0, 0.025, z + off);
        sw.receiveShadow = true; this.scene.add(sw);
      }

      for (let x = -29; x < 30; x += 3) {
        if (STREETS_X.some(sx => Math.abs(x + 1 - sx) < ROAD_HW + 0.5)) continue;
        const d = new THREE.Mesh(new THREE.PlaneGeometry(2, 0.12), dashMat);
        d.rotation.x = -Math.PI / 2; d.position.set(x + 1, 0.025, z); this.scene.add(d);
      }

      for (const laneOff of [-0.5, 0.5]) {
        for (let x = -29; x < 30; x += 2) {
          if (STREETS_X.some(sx => Math.abs(x + 1 - sx) < ROAD_HW + 0.5)) continue;
          const l = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.06), lineMat);
          l.rotation.x = -Math.PI / 2; l.position.set(x + 0.5, 0.026, z + laneOff); this.scene.add(l);
        }
      }

      this.roadSegments.push(
        { from: new THREE.Vector3(-28, 0, z - 0.5), to: new THREE.Vector3(28, 0, z - 0.5) },
        { from: new THREE.Vector3(28, 0, z + 0.5), to: new THREE.Vector3(-28, 0, z + 0.5) },
      );
    }

    // Vertical roads
    for (const x of STREETS_X) {
      const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, 60), roadMat);
      road.rotation.x = -Math.PI / 2; road.position.set(x, 0.016, 0);
      road.receiveShadow = true; this.scene.add(road);

      for (const off of [-(ROAD_HW + SIDEWALK_W / 2), ROAD_HW + SIDEWALK_W / 2]) {
        const sw = new THREE.Mesh(new THREE.PlaneGeometry(SIDEWALK_W, 60), swMat);
        sw.rotation.x = -Math.PI / 2; sw.position.set(x + off, 0.026, 0);
        sw.receiveShadow = true; this.scene.add(sw);
      }

      for (let z = -29; z < 30; z += 3) {
        if (STREETS_Z.some(sz => Math.abs(z + 1 - sz) < ROAD_HW + 0.5)) continue;
        const d = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 2), dashMat);
        d.rotation.x = -Math.PI / 2; d.position.set(x, 0.025, z + 1); this.scene.add(d);
      }

      this.roadSegments.push(
        { from: new THREE.Vector3(x - 0.5, 0, -28), to: new THREE.Vector3(x - 0.5, 0, 28) },
        { from: new THREE.Vector3(x + 0.5, 0, 28), to: new THREE.Vector3(x + 0.5, 0, -28) },
      );
    }

    // Intersection pads + crosswalks
    const intMat = new THREE.MeshStandardMaterial({ color: 0x252830, roughness: 0.95 });
    const cwMat  = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2 });
    for (const x of STREETS_X) {
      for (const z of STREETS_Z) {
        const pad = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W + 0.4, ROAD_W + 0.4), intMat);
        pad.rotation.x = -Math.PI / 2; pad.position.set(x, 0.018, z);
        pad.receiveShadow = true; this.scene.add(pad);

        for (let i = -3; i <= 3; i++) {
          const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.15, ROAD_W * 0.8), cwMat);
          bar.rotation.x = -Math.PI / 2; bar.position.set(x + i * 0.25, 0.022, z - ROAD_HW - 0.15);
          this.scene.add(bar);
        }

        // 3D crossroad tile
        const model = await this.loadModel('roads', 'road-crossroad');
        if (model) { model.position.set(x, 0.005, z); model.scale.setScalar(1.0); this.scene.add(model); }
      }
    }

    // 3D road tiles between intersections
    const tileStraight = ['road-straight', 'road-straight-sidewalk', 'road-straight-line'];
    let ti = 0;
    for (const z of STREETS_Z) {
      for (let i = 0; i < STREETS_X.length - 1; i++) {
        const mx = (STREETS_X[i] + STREETS_X[i + 1]) / 2;
        const m = await this.loadModel('roads', tileStraight[ti++ % tileStraight.length]);
        if (m) { m.position.set(mx, 0.004, z); m.scale.setScalar(1.0); this.scene.add(m); }
      }
    }
    for (const x of STREETS_X) {
      for (let i = 0; i < STREETS_Z.length - 1; i++) {
        const mz = (STREETS_Z[i] + STREETS_Z[i + 1]) / 2;
        const m = await this.loadModel('roads', tileStraight[ti++ % tileStraight.length]);
        if (m) { m.position.set(x, 0.004, mz); m.rotation.y = Math.PI / 2; m.scale.setScalar(1.0); this.scene.add(m); }
      }
    }

    console.log('[CityPopulator] Grid:', STREETS_X.length, 'x', STREETS_Z.length, 'streets,', this.roadSegments.length, 'lanes');
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  Fill city blocks
  // ══════════════════════════════════════════════════════════════════════════
  private async fillAllBlocks(zones: BBox[], onProgress?: (pct: number) => void) {
    const blocks: Array<{ cx: number; cz: number; district: District }> = [];
    for (let i = 0; i < STREETS_X.length - 1; i++) {
      for (let j = 0; j < STREETS_Z.length - 1; j++) {
        const cx = (STREETS_X[i] + STREETS_X[i + 1]) / 2;
        const cz = (STREETS_Z[j] + STREETS_Z[j + 1]) / 2;
        if (inZone(cx, cz, zones)) continue;
        blocks.push({ cx, cz, district: classifyPos(cx, cz) });
      }
    }
    console.log('[CityPopulator] Filling', blocks.length, 'blocks');

    for (let b = 0; b < blocks.length; b++) {
      await this.fillBlock(blocks[b].cx, blocks[b].cz, blocks[b].district, zones);
      if (b % 5 === 0) onProgress?.(20 + Math.round((b / blocks.length) * 60));
    }
  }

  private async fillBlock(cx: number, cz: number, district: District, zones: BBox[]) {
    const r = this.rng;
    const inner = (BLOCK_SIZE - ROAD_W) / 2 - 0.4; // ~2.6

    // 10% chance: park
    if (r() < 0.10) { await this.fillPark(cx, cz, inner, zones); return; }

    let catalogue: string[], dir: string, baseScale: number;
    switch (district) {
      case 'downtown':   catalogue = DOWNTOWN;   dir = 'commercial'; baseScale = 1.2; break;
      case 'industrial': catalogue = INDUSTRIAL; dir = 'industrial'; baseScale = 1.0; break;
      default:           catalogue = SUBURBAN;    dir = 'suburban';   baseScale = 0.9; break;
    }

    // 2x2 grid positions within block
    const slots = [
      { x: cx - inner * 0.5, z: cz - inner * 0.5 },
      { x: cx + inner * 0.5, z: cz - inner * 0.5 },
      { x: cx - inner * 0.5, z: cz + inner * 0.5 },
      { x: cx + inner * 0.5, z: cz + inner * 0.5 },
    ];

    let fill: number;
    switch (district) {
      case 'downtown':   fill = 3 + Math.floor(r() * 2); break;
      case 'industrial': fill = 2 + Math.floor(r() * 2); break;
      default:           fill = 1 + Math.floor(r() * 2); break;
    }

    // Shuffle
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }

    for (let s = 0; s < Math.min(fill, slots.length); s++) {
      const px = slots[s].x + (r() - 0.5) * 0.3;
      const pz = slots[s].z + (r() - 0.5) * 0.3;
      if (inZone(px, pz, zones) || onAnyRoad(px, pz)) continue;

      const file = catalogue[Math.floor(r() * catalogue.length)];
      const scale = baseScale * (0.85 + r() * 0.3);
      const model = await this.loadModel(dir, file);
      if (model) {
        model.position.set(px, 0, pz);
        model.scale.setScalar(scale);
        model.rotation.y = Math.floor(r() * 4) * (Math.PI / 2);
        this.scene.add(model);
        if (file.startsWith('chimney')) this.chimneyPositions.push(new THREE.Vector3(px, scale * 2.5, pz));
      } else {
        this.placeFallback(px, pz, district, scale);
      }
    }

    // Remaining slots get vegetation
    for (let s = fill; s < slots.length; s++) {
      if (r() < 0.4) continue;
      const px = slots[s].x, pz = slots[s].z;
      if (inZone(px, pz, zones) || onAnyRoad(px, pz)) continue;
      const veg = VEGETATION[Math.floor(r() * VEGETATION.length)];
      const m = await this.loadModel(veg.dir, veg.file);
      if (m) { m.position.set(px, 0, pz); m.scale.setScalar(0.6 + r() * 0.3); m.rotation.y = r() * Math.PI * 2; this.scene.add(m); }
    }
  }

  private async fillPark(cx: number, cz: number, inner: number, zones: BBox[]) {
    const r = this.rng;
    const parkMat = new THREE.MeshStandardMaterial({ color: 0x1a3318, roughness: 0.9 });
    const park = new THREE.Mesh(new THREE.PlaneGeometry(inner * 1.8, inner * 1.8), parkMat);
    park.rotation.x = -Math.PI / 2; park.position.set(cx, 0.02, cz);
    park.receiveShadow = true; this.scene.add(park);

    for (let i = 0; i < 3 + Math.floor(r() * 4); i++) {
      const px = cx + (r() - 0.5) * inner * 1.4;
      const pz = cz + (r() - 0.5) * inner * 1.4;
      if (inZone(px, pz, zones)) continue;
      const veg = VEGETATION[Math.floor(r() * VEGETATION.length)];
      const m = await this.loadModel(veg.dir, veg.file);
      if (m) { m.position.set(px, 0, pz); m.scale.setScalar(0.6 + r() * 0.4); m.rotation.y = r() * Math.PI * 2; this.scene.add(m); }
    }
  }

  private placeFallback(x: number, z: number, district: District, scale: number) {
    const colors: Record<District, number> = { downtown: 0x334455, industrial: 0x443322, suburban: 0x335544 };
    const h = scale * (0.6 + this.rng() * 1.0);
    const geo = new THREE.BoxGeometry(0.5 + this.rng() * 0.6, h, 0.5 + this.rng() * 0.6);
    const mat = new THREE.MeshLambertMaterial({ color: colors[district] });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, h / 2, z); mesh.castShadow = true; mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  Street furniture
  // ══════════════════════════════════════════════════════════════════════════
  private async placeStreetFurniture(zones: BBox[]) {
    const r = this.rng;
    for (const x of STREETS_X) {
      for (const z of STREETS_Z) {
        const corners = [
          { dx: ROAD_HW + 0.3, dz: ROAD_HW + 0.3, ry: 0 },
          { dx: -(ROAD_HW + 0.3), dz: ROAD_HW + 0.3, ry: Math.PI / 2 },
          { dx: -(ROAD_HW + 0.3), dz: -(ROAD_HW + 0.3), ry: Math.PI },
          { dx: ROAD_HW + 0.3, dz: -(ROAD_HW + 0.3), ry: -Math.PI / 2 },
        ];
        const ct = 1 + Math.floor(r() * 2);
        for (let c = 0; c < ct; c++) {
          const corner = corners[Math.floor(r() * corners.length)];
          const lx = x + corner.dx, lz = z + corner.dz;
          if (inZone(lx, lz, zones)) continue;
          const m = await this.loadModel('roads', r() > 0.5 ? 'light-curved' : 'light-square');
          if (m) { m.position.set(lx, 0, lz); m.scale.setScalar(0.8); m.rotation.y = corner.ry; this.scene.add(m); }
          const pl = new THREE.PointLight(0xffe8aa, 0.35, 8);
          pl.position.set(lx, 3.0, lz); this.scene.add(pl);
        }
      }
    }

    for (const x of STREETS_X) {
      for (let z = -26; z <= 26; z += BLOCK_SIZE) {
        if (r() < 0.7) continue;
        const sf = STREET_FURNITURE[2 + Math.floor(r() * 3)];
        const lx = x + (r() > 0.5 ? 1.5 : -1.5);
        if (inZone(lx, z, zones)) continue;
        const m = await this.loadModel(sf.dir, sf.file);
        if (m) { m.position.set(lx, 0, z); m.scale.setScalar(0.7); m.rotation.y = r() * Math.PI * 2; this.scene.add(m); }
      }
    }
    console.log('[CityPopulator] Street furniture placed');
  }
}
