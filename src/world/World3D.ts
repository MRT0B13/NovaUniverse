import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ZONES, AGENT_DEFS, WORLD_WIDTH, WORLD_HEIGHT, ACTION_ZONE_MAP } from '../config/constants';
import { AgentObject3D } from './AgentObject3D';
import { VehicleObject3D } from './VehicleObject3D';
import { CityPopulator } from './CityPopulator';
import { AmbientLife } from './AmbientLife';
import { ZoneLayout } from './ZoneLayout';
import { CollisionWorld } from './CollisionWorld';
import { WeatherSystem } from './WeatherSystem';
import type { WeatherState } from './WeatherSystem';
import { apiFetch } from '../utils/auth';
import type { HUD } from '../ui/HUD';
import type { UniverseEvent } from '../events/EventClient';

// ── Constants ─────────────────────────────────────────────────────────────────
const SCALE         = 0.01;   // world pixels → Three.js units
const GROUND_Y      = 0;
const CAM_HEIGHT    = 28;
const WORLD_CX      = (WORLD_WIDTH  * SCALE) / 2;  // ~12
const WORLD_CZ      = (WORLD_HEIGHT * SCALE) / 2;  // ~9

// ── Zone → building assignment ────────────────────────────────────────────────
const ZONE_BUILDINGS: Record<string, { dir: string; files: string[]; count: number }> = {
  trading_floor:  { dir: 'commercial',  files: ['building-skyscraper-a','building-skyscraper-b','building-skyscraper-c','building-c','building-d','building-e','building-f'], count: 7 },
  intel_hub:      { dir: 'commercial',  files: ['building-e','building-f','building-g','building-h','low-detail-building-c','low-detail-building-d'], count: 6 },
  watchtower:     { dir: 'industrial',  files: ['building-a','building-b','building-c','chimney-large','chimney-medium','building-d'], count: 6 },
  command_center: { dir: 'commercial',  files: ['building-skyscraper-d','building-skyscraper-e','building-a','building-b','building-c','low-detail-building-a'], count: 6 },
  launchpad:      { dir: 'industrial',  files: ['building-h','building-i','building-j','building-k','detail-tank','building-l'], count: 6 },
  agora:          { dir: 'suburban',    files: ['building-type-a','building-type-b','building-type-c','building-type-d','tree-large','tree-small','building-type-e'], count: 7 },
  orca_pool:      { dir: 'commercial',  files: ['low-detail-building-a','low-detail-building-b','low-detail-building-d','low-detail-building-e'], count: 4 },
  burn_furnace:   { dir: 'industrial',  files: ['chimney-large','chimney-small','chimney-basic','detail-tank','building-d','building-e'], count: 6 },
  nova_bank:      { dir: 'commercial',  files: ['building-a','building-b','building-c','building-d','low-detail-building-a','low-detail-building-b'], count: 6 },
};



// ── Agent → character model + tint colour ─────────────────────────────────────
export const AGENT_MODELS: Record<string, { model: string; color: number; cssColor: string }> = {
  'nova-cfo':        { model: 'character-c', color: 0x00ff88, cssColor: '#00ff88' },
  'nova-scout':      { model: 'character-a', color: 0x00c8ff, cssColor: '#00c8ff' },
  'nova-guardian':   { model: 'character-g', color: 0xff9500, cssColor: '#ff9500' },
  'nova-supervisor': { model: 'character-e', color: 0xc084fc, cssColor: '#c084fc' },
  'nova-analyst':    { model: 'character-k', color: 0x00c8ff, cssColor: '#00c8ff' },
  'nova-launcher':   { model: 'character-b', color: 0xf472b6, cssColor: '#f472b6' },
  'nova-community':  { model: 'character-i', color: 0xffd700, cssColor: '#ffd700' },
};



// ── Zone colours ──────────────────────────────────────────────────────────────
const ZONE_COLORS: Record<string, number> = {
  trading_floor: 0x00ff88, intel_hub:     0x00c8ff,
  watchtower:    0xff9500, command_center: 0xc084fc,
  launchpad:     0xf472b6, agora:         0xffd700,
  orca_pool:     0x00ff88, burn_furnace:  0xff4444,
  nova_bank:     0xffd700,
};

// ── 3D Zone positions (hand-tuned, no SCALE conversion) ──────────────────────
// Layout: 3-column grid with generous spacing.  Roads run between zones.
//
//   Row 0 (north):   trading_floor  |  intel_hub     |  watchtower
//   Row 1 (mid):     orca_pool      |  command_center |  agora
//   Row 2 (south):   launchpad      |  nova_bank     |  burn_furnace
//
export const ZONE_3D: Record<string, { cx: number; cz: number; w: number; h: number }> = {
  // Row 0 — north
  trading_floor:  { cx: -9,   cz: -7,   w: 5.6,  h: 4.4 },
  intel_hub:      { cx:  0,   cz: -7,   w: 5.0,  h: 4.0 },
  watchtower:     { cx:  9,   cz: -7,   w: 4.6,  h: 4.0 },
  // Row 1 — middle
  orca_pool:      { cx: -9,   cz:  0,   w: 4.2,  h: 3.4 },
  command_center: { cx:  0,   cz:  0,   w: 5.6,  h: 4.4 },
  agora:          { cx:  9,   cz:  0,   w: 4.6,  h: 3.8 },
  // Row 2 — south
  launchpad:      { cx: -9,   cz:  7,   w: 5.0,  h: 4.0 },
  nova_bank:      { cx:  0,   cz:  7,   w: 4.6,  h: 3.6 },
  burn_furnace:   { cx:  9,   cz:  7,   w: 4.2,  h: 3.4 },
};

// ── Roads between zones (each segment = [start, end]) ────────────────────────
const ROAD_SEGMENTS: Array<[THREE.Vector2, THREE.Vector2]> = [
  // ── Horizontal links (same row) ──
  [new THREE.Vector2(-6, -7),  new THREE.Vector2(-3, -7)],   // trading → intel
  [new THREE.Vector2( 3, -7),  new THREE.Vector2( 6, -7)],   // intel → watchtower
  [new THREE.Vector2(-6,  0),  new THREE.Vector2(-3,  0)],   // orca → command
  [new THREE.Vector2( 3,  0),  new THREE.Vector2( 6,  0)],   // command → agora
  [new THREE.Vector2(-6,  7),  new THREE.Vector2(-3,  7)],   // launchpad → nova_bank
  [new THREE.Vector2( 3,  7),  new THREE.Vector2( 6,  7)],   // nova_bank → burn
  // ── Vertical links (same column) ──
  [new THREE.Vector2(-9, -4.5), new THREE.Vector2(-9, -2)],  // trading ↓ orca
  [new THREE.Vector2(-9,  2),   new THREE.Vector2(-9,  4.5)],// orca ↓ launchpad
  [new THREE.Vector2( 0, -4.5), new THREE.Vector2( 0, -2)],  // intel ↓ command
  [new THREE.Vector2( 0,  2),   new THREE.Vector2( 0,  4.5)],// command ↓ nova_bank
  [new THREE.Vector2( 9, -4.5), new THREE.Vector2( 9, -2)],  // watchtower ↓ agora
  [new THREE.Vector2( 9,  2),   new THREE.Vector2( 9,  4.5)],// agora ↓ burn
];

// ── Vehicle patrol paths (loop waypoints along roads) ─────────────────────────
const ROAD_PATHS_3D: THREE.Vector3[][] = [
  // Loop 1: trading → intel → command → orca → trading
  [new THREE.Vector3(-9, 0, -7), new THREE.Vector3(0, 0, -7), new THREE.Vector3(0, 0, 0), new THREE.Vector3(-9, 0, 0), new THREE.Vector3(-9, 0, -7)],
  // Loop 2: intel → watchtower → agora → command → intel
  [new THREE.Vector3(0, 0, -7), new THREE.Vector3(9, 0, -7), new THREE.Vector3(9, 0, 0), new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -7)],
  // Loop 3: orca → launchpad → nova_bank → command → orca
  [new THREE.Vector3(-9, 0, 0), new THREE.Vector3(-9, 0, 7), new THREE.Vector3(0, 0, 7), new THREE.Vector3(0, 0, 0), new THREE.Vector3(-9, 0, 0)],
  // Loop 4: agora → burn → nova_bank → command → agora
  [new THREE.Vector3(9, 0, 0), new THREE.Vector3(9, 0, 7), new THREE.Vector3(0, 0, 7), new THREE.Vector3(0, 0, 0), new THREE.Vector3(9, 0, 0)],
];

// ════════════════════════════════════════════════════════════════════════════════
//  World3D — main Three.js world
// ════════════════════════════════════════════════════════════════════════════════

export class World3D {
  private renderer: THREE.WebGLRenderer;
  private threeScene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private loader: GLTFLoader;
  private texLoader: THREE.TextureLoader;
  private clock: THREE.Clock;
  private hud: HUD | null = null;

  // 3D objects
  private agents = new Map<string, AgentObject3D>();
  private mixers: THREE.AnimationMixer[] = [];

  // City populator + ambient life
  private cityPopulator: CityPopulator;
  private ambientLife: AmbientLife;

  // Zone layout + collision + weather
  private zoneLayouts = new Map<string, ZoneLayout>();
  private buildingBoxes: THREE.Box3[] = [];
  private collision = new CollisionWorld();
  private weather!: WeatherSystem;
  private sun!: THREE.DirectionalLight;
  private ambient!: THREE.AmbientLight;
  private fog!: THREE.FogExp2;

  // Camera control state — start focused on Command Center
  private camTarget = new THREE.Vector3(0, 0, 0);
  private camTargetSmooth = new THREE.Vector3(0, 0, 0);
  private camOffset = new THREE.Vector3(0, CAM_HEIGHT, CAM_HEIGHT * 0.8);
  private camOffsetSmooth = new THREE.Vector3(0, CAM_HEIGHT * 1.3, CAM_HEIGHT * 1.1);
  private isDragging = false;
  private lastMouse = { x: 0, y: 0 };
  private panSpeed = 0.05;
  private keys = new Set<string>();

  // Raycasting for click detection
  private raycaster = new THREE.Raycaster();
  private clickables: Array<{ mesh: THREE.Object3D; type: 'agent' | 'zone'; id: string }> = [];

  // Fallback building geometry (used if GLB not found)
  private fallbackGeo = new THREE.BoxGeometry(0.6, 1.2, 0.6);

  // Zone identity
  private zoneLights = new Map<string, THREE.PointLight>();
  private zoneEdgeMats: THREE.MeshStandardMaterial[] = [];
  private zoneLabels: THREE.Sprite[] = [];
  private skyUniforms: { topColor: THREE.IUniform; bottomColor: THREE.IUniform } | null = null;
  private vehicles: VehicleObject3D[] = [];

  private sceneReady = false;

  // Zone ambient particle systems
  private burnEmbers: { points: THREE.Points; velocities: Float32Array } | null = null;
  private launchSparks: { points: THREE.Points; velocities: Float32Array } | null = null;

  // ── Constructor ─────────────────────────────────────────────────────────────

  constructor(canvas: HTMLCanvasElement) {
    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const skyColor = 0x1a1a2e;
    this.renderer.setClearColor(skyColor);

    // Scene
    this.threeScene = new THREE.Scene();
    this.threeScene.background = new THREE.Color(skyColor);
    this.fog = new THREE.FogExp2(skyColor, 0.003);
    this.threeScene.fog = this.fog;

    // Camera
    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
    this.updateCamera();

    // Loaders
    this.loader = new GLTFLoader();
    this.texLoader = new THREE.TextureLoader();
    this.clock = new THREE.Clock();

    // City systems
    this.cityPopulator = new CityPopulator(this.threeScene, this.loader, this.texLoader);
    this.ambientLife   = new AmbientLife(this.threeScene, this.loader, this.texLoader);

    // Lighting
    this.setupLighting();

    // Init weather system (needs sun, ambient, fog — set up by setupLighting)
    this.weather = new WeatherSystem(this.threeScene, this.sun, this.ambient, this.fog);

    // Ground + roads + zone pads
    this.buildGround();

    // Controls
    this.setupControls(canvas);

    // Resize handler
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  setHUD(hud: HUD) { this.hud = hud; }

  // ── Lighting ────────────────────────────────────────────────────────────────

  private setupLighting() {
    // Ambient — brighter base for better visibility
    this.ambient = new THREE.AmbientLight(0x334466, 1.8);
    this.threeScene.add(this.ambient);

    // Main directional — warm sunlight
    this.sun = new THREE.DirectionalLight(0xfff0d0, 3.0);
    this.sun.position.set(20, 40, 15);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 0.1;
    this.sun.shadow.camera.far = 120;
    this.sun.shadow.camera.left = -35;
    this.sun.shadow.camera.right = 35;
    this.sun.shadow.camera.top = 35;
    this.sun.shadow.camera.bottom = -35;
    this.threeScene.add(this.sun);

    // Fill light — cool blue from opposite side
    const fill = new THREE.DirectionalLight(0x8899ff, 1.0);
    fill.position.set(-15, 12, -15);
    this.threeScene.add(fill);

    // Hemisphere light — sky/ground colour gradient
    const hemi = new THREE.HemisphereLight(0x446688, 0x222211, 0.6);
    this.threeScene.add(hemi);
  }

  // ── Ground plane ────────────────────────────────────────────────────────────

  private buildGround() {
    // === Procedural ground texture (asphalt with subtle noise) ===
    const groundCanvas = document.createElement('canvas');
    groundCanvas.width = 512;
    groundCanvas.height = 512;
    const gctx = groundCanvas.getContext('2d')!;

    // Base dark asphalt
    gctx.fillStyle = '#0e0f14';
    gctx.fillRect(0, 0, 512, 512);

    // Subtle noise for asphalt texture
    for (let i = 0; i < 10000; i++) {
      const nx = Math.random() * 512;
      const ny = Math.random() * 512;
      const brightness = 12 + Math.floor(Math.random() * 10);
      gctx.fillStyle = `rgb(${brightness},${brightness + 1},${brightness + 3})`;
      gctx.fillRect(nx, ny, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }

    const groundTex = new THREE.CanvasTexture(groundCanvas);
    groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
    groundTex.repeat.set(15, 15);

    const groundGeo = new THREE.PlaneGeometry(60, 60, 1, 1);
    const groundMat = new THREE.MeshStandardMaterial({
      map: groundTex,
      roughness: 0.95,
      metalness: 0.0,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.threeScene.add(ground);

    // Zone floor pads + borders + accent lights
    this.addZonePads();

    // Zone-specific ground treatments and themed props
    this.buildZoneDetails();

    // Roads between zones
    this.addRoadStripes();

    // === Sky dome (gradient hemisphere) ===
    this.buildSkyDome();

    // === Floating atmosphere particles ===
    this.buildAtmosphere();
  }

  /** Shader-based sky dome with day/night uniforms */
  private buildSkyDome() {
    const skyGeo = new THREE.SphereGeometry(90, 32, 16);
    this.skyUniforms = {
      topColor:    { value: new THREE.Color(0x040610) },
      bottomColor: { value: new THREE.Color(0x0a0a14) },
    };
    const skyMat = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPosition = wp.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition).y;
          float t = clamp(h * 0.5 + 0.5, 0.0, 1.0);
          gl_FragColor = vec4(mix(bottomColor, topColor, t), 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    this.threeScene.add(sky);
  }

  /** Floating dust / haze particles for atmosphere */
  private atmospherePoints: THREE.Points | null = null;
  private atmosphereVelocities: Float32Array | null = null;

  private buildAtmosphere() {
    const count = 600;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * 60;
      positions[i * 3 + 1] = 0.3 + Math.random() * 12;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 60;
      velocities[i * 3]     = (Math.random() - 0.5) * 0.003;
      velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.001;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.003;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x8899bb,
      size: 0.08,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
    });
    this.atmospherePoints = new THREE.Points(geo, mat);
    this.atmosphereVelocities = velocities;
    this.threeScene.add(this.atmospherePoints);
  }

  // Roads are now built by addRoadStripes() between zones

  private addZonePads() {
    for (const [key, z] of Object.entries(ZONE_3D)) {
      const color = ZONE_COLORS[key] ?? 0x333333;
      const { cx, cz, w, h } = z;
      const hw = w / 2, hh = h / 2;

      // ── 1. Zone floor pad ──────────────────────────────────────────
      const padGeo = new THREE.PlaneGeometry(w, h);
      const padMat = new THREE.MeshLambertMaterial({
        color: new THREE.Color(color).multiplyScalar(0.06),
        transparent: true,
        opacity: 0.92,
      });
      const pad = new THREE.Mesh(padGeo, padMat);
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(cx, 0.015, cz);
      pad.receiveShadow = true;
      this.threeScene.add(pad);

      // ── 2. Edge bars (thin emissive boxes) ─────────────────────────
      const barH = 0.06, barD = 0.04;
      const edgeMat = new THREE.MeshStandardMaterial({
        color, emissive: new THREE.Color(color), emissiveIntensity: 0.6,
        transparent: true, opacity: 0.7,
      });
      this.zoneEdgeMats.push(edgeMat);
      const edges: [number, number, number, number, number][] = [
        [cx, cz - hh, w, barH, barD],   // north
        [cx, cz + hh, w, barH, barD],   // south
        [cx - hw, cz, barD, barH, h],   // west
        [cx + hw, cz, barD, barH, h],   // east
      ];
      for (const [ex, ez, ew, eh, ed] of edges) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(ew, eh, ed), edgeMat);
        bar.position.set(ex, 0.04, ez);
        this.threeScene.add(bar);
      }

      // ── 3. Corner pillars ──────────────────────────────────────────
      const pillarGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.5, 6);
      const pillarMat = new THREE.MeshStandardMaterial({
        color, emissive: new THREE.Color(color), emissiveIntensity: 0.8,
      });
      for (const dx of [-hw, hw]) {
        for (const dz of [-hh, hh]) {
          const pillar = new THREE.Mesh(pillarGeo, pillarMat);
          pillar.position.set(cx + dx, 0.25, cz + dz);
          pillar.castShadow = true;
          this.threeScene.add(pillar);
        }
      }

      // ── 4. Zone accent point light ─────────────────────────────────
      const light = new THREE.PointLight(color, 0.8, 8);
      light.position.set(cx, 2.0, cz);
      this.threeScene.add(light);
      this.zoneLights.set(key, light);

      // ── 5. Invisible click zone ────────────────────────────────────
      const clickPad = new THREE.Mesh(
        new THREE.BoxGeometry(w, 0.01, h),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      clickPad.position.set(cx, 0.05, cz);
      this.threeScene.add(clickPad);
      this.clickables.push({ mesh: clickPad, type: 'zone', id: key });
    }
  }

  /** Zone-specific ground treatments, themed props, and visual identity */
  private buildZoneDetails() {
    for (const [key, z] of Object.entries(ZONE_3D)) {
      const color = ZONE_COLORS[key] ?? 0x333333;
      const { cx, cz, w, h } = z;

      switch (key) {
        case 'trading_floor':
          this.buildTradingFloorDetails(cx, cz, w, h, color);
          break;
        case 'intel_hub':
          this.buildIntelHubDetails(cx, cz, w, h, color);
          break;
        case 'watchtower':
          this.buildWatchtowerDetails(cx, cz, w, h, color);
          break;
        case 'command_center':
          this.buildCommandCenterDetails(cx, cz, w, h, color);
          break;
        case 'launchpad':
          this.buildLaunchpadDetails(cx, cz, w, h, color);
          break;
        case 'agora':
          this.buildAgoraDetails(cx, cz, w, h, color);
          break;
        case 'orca_pool':
          this.buildOrcaPoolDetails(cx, cz, w, h, color);
          break;
        case 'burn_furnace':
          this.buildBurnFurnaceDetails(cx, cz, w, h, color);
          break;
        case 'nova_bank':
          this.buildNovaBankDetails(cx, cz, w, h, color);
          break;
      }
    }
  }

  // ── Trading Floor: polished dark floor with green grid lines, terminal screens ──
  private buildTradingFloorDetails(cx: number, cz: number, w: number, h: number, color: number) {
    const gridMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.15 });
    // Horizontal grid lines
    const spacing = 0.5;
    for (let z = cz - h / 2 + spacing; z < cz + h / 2; z += spacing) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.2, 0.02), gridMat);
      line.rotation.x = -Math.PI / 2;
      line.position.set(cx, 0.025, z);
      this.threeScene.add(line);
    }
    // Vertical grid lines
    for (let x = cx - w / 2 + spacing; x < cx + w / 2; x += spacing) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(0.02, h - 0.2), gridMat);
      line.rotation.x = -Math.PI / 2;
      line.position.set(x, 0.025, cz);
      this.threeScene.add(line);
    }

    // Glowing center ticker strip
    const tickerMat = new THREE.MeshStandardMaterial({
      color, emissive: new THREE.Color(color), emissiveIntensity: 0.4,
      transparent: true, opacity: 0.6,
    });
    const ticker = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.8, 0.08), tickerMat);
    ticker.rotation.x = -Math.PI / 2;
    ticker.position.set(cx, 0.03, cz);
    this.threeScene.add(ticker);
  }

  // ── Intel Hub: blue data line patterns, antenna base markers ──
  private buildIntelHubDetails(cx: number, cz: number, w: number, h: number, color: number) {
    const lineMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12 });

    // Radial data lines from center
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 6) {
      const len = Math.min(w, h) * 0.4;
      const lineGeo = new THREE.PlaneGeometry(0.03, len);
      const line = new THREE.Mesh(lineGeo, lineMat);
      line.rotation.x = -Math.PI / 2;
      line.rotation.z = angle;
      line.position.set(cx, 0.025, cz);
      this.threeScene.add(line);
    }

    // Concentric rings
    for (let r = 0.4; r <= Math.min(w, h) * 0.4; r += 0.5) {
      const ringGeo = new THREE.RingGeometry(r - 0.02, r + 0.02, 32);
      const ring = new THREE.Mesh(ringGeo, lineMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(cx, 0.025, cz);
      this.threeScene.add(ring);
    }
  }

  // ── Watchtower: industrial grating, orange warning stripes ──
  private buildWatchtowerDetails(cx: number, cz: number, w: number, h: number, color: number) {
    // Warning stripes along edges
    const stripeMat = new THREE.MeshBasicMaterial({ color: 0xff9500, transparent: true, opacity: 0.2 });
    const stripeW = 0.15;
    const hw = w / 2, hh = h / 2;

    // Diagonal warning stripes on inner edge
    for (let i = -5; i <= 5; i++) {
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(stripeW, 0.6), stripeMat);
      stripe.rotation.x = -Math.PI / 2;
      stripe.rotation.z = Math.PI / 4;
      stripe.position.set(cx - hw + 0.3, 0.025, cz + i * 0.4);
      this.threeScene.add(stripe);

      const stripe2 = new THREE.Mesh(new THREE.PlaneGeometry(stripeW, 0.6), stripeMat);
      stripe2.rotation.x = -Math.PI / 2;
      stripe2.rotation.z = Math.PI / 4;
      stripe2.position.set(cx + hw - 0.3, 0.025, cz + i * 0.4);
      this.threeScene.add(stripe2);
    }

    // Central cross marker
    const crossMat = new THREE.MeshStandardMaterial({
      color, emissive: new THREE.Color(color), emissiveIntensity: 0.3,
      transparent: true, opacity: 0.5,
    });
    const crossH = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.06), crossMat);
    crossH.rotation.x = -Math.PI / 2;
    crossH.position.set(cx, 0.025, cz);
    this.threeScene.add(crossH);
    const crossV = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 1.5), crossMat);
    crossV.rotation.x = -Math.PI / 2;
    crossV.position.set(cx, 0.025, cz);
    this.threeScene.add(crossV);
  }

  // ── Command Center: elevated purple platform, central podium ──
  private buildCommandCenterDetails(cx: number, cz: number, w: number, h: number, color: number) {
    // Raised inner platform
    const platGeo = new THREE.BoxGeometry(w * 0.6, 0.08, h * 0.6);
    const platMat = new THREE.MeshStandardMaterial({
      color: 0x110022, emissive: new THREE.Color(color), emissiveIntensity: 0.15,
      roughness: 0.4,
    });
    const platform = new THREE.Mesh(platGeo, platMat);
    platform.position.set(cx, 0.04, cz);
    platform.receiveShadow = true;
    this.threeScene.add(platform);

    // Central hex podium
    const hexGeo = new THREE.CylinderGeometry(0.3, 0.35, 0.15, 6);
    const hexMat = new THREE.MeshStandardMaterial({
      color, emissive: new THREE.Color(color), emissiveIntensity: 0.5,
    });
    const hex = new THREE.Mesh(hexGeo, hexMat);
    hex.position.set(cx, 0.12, cz);
    hex.castShadow = true;
    this.threeScene.add(hex);

    // Ring around podium
    const ringGeo = new THREE.RingGeometry(0.45, 0.5, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(cx, 0.03, cz);
    this.threeScene.add(ring);
  }

  // ── Launchpad: scorched concrete, blast marks, landing pad circle ──
  private buildLaunchpadDetails(cx: number, cz: number, w: number, h: number, color: number) {
    // Scorched center circle
    const scorchMat = new THREE.MeshStandardMaterial({
      color: 0x1a0808, roughness: 1.0,
      transparent: true, opacity: 0.8,
    });
    const scorch = new THREE.Mesh(new THREE.CircleGeometry(0.8, 24), scorchMat);
    scorch.rotation.x = -Math.PI / 2;
    scorch.position.set(cx, 0.022, cz);
    scorch.receiveShadow = true;
    this.threeScene.add(scorch);

    // Landing pad markings — concentric rings
    const padMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25 });
    for (const r of [0.6, 0.9, 1.2]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.03, r + 0.03, 32), padMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(cx, 0.025, cz);
      this.threeScene.add(ring);
    }

    // Cross hairs
    const crossMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.2 });
    const crossH = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.04), crossMat);
    crossH.rotation.x = -Math.PI / 2;
    crossH.position.set(cx, 0.025, cz);
    this.threeScene.add(crossH);
    const crossV = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 2.4), crossMat);
    crossV.rotation.x = -Math.PI / 2;
    crossV.position.set(cx, 0.025, cz);
    this.threeScene.add(crossV);

    // Spark particles rising from pad
    const sparkCount = 25;
    const sPos = new Float32Array(sparkCount * 3);
    const sVel = new Float32Array(sparkCount * 3);
    for (let i = 0; i < sparkCount; i++) {
      sPos[i * 3]     = cx + (Math.random() - 0.5) * 1.2;
      sPos[i * 3 + 1] = Math.random() * 3;
      sPos[i * 3 + 2] = cz + (Math.random() - 0.5) * 1.2;
      sVel[i * 3]     = (Math.random() - 0.5) * 0.003;
      sVel[i * 3 + 1] = 0.008 + Math.random() * 0.015;
      sVel[i * 3 + 2] = (Math.random() - 0.5) * 0.003;
    }
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    const sMat = new THREE.PointsMaterial({
      color: 0xf472b6, size: 0.05, transparent: true, opacity: 0.7,
      sizeAttenuation: true, depthWrite: false,
    });
    const sparks = new THREE.Points(sGeo, sMat);
    sparks.frustumCulled = false;
    this.threeScene.add(sparks);
    this.launchSparks = { points: sparks, velocities: sVel };
  }

  // ── Agora: warm golden paving, open plaza feel ──
  private buildAgoraDetails(cx: number, cz: number, w: number, h: number, color: number) {
    // Warm paving overlay
    const paveMat = new THREE.MeshStandardMaterial({
      color: 0x2a2510, roughness: 0.8,
      transparent: true, opacity: 0.5,
    });
    const pave = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.85, h * 0.85), paveMat);
    pave.rotation.x = -Math.PI / 2;
    pave.position.set(cx, 0.02, cz);
    pave.receiveShadow = true;
    this.threeScene.add(pave);

    // Decorative corner accents
    const accentMat = new THREE.MeshStandardMaterial({
      color, emissive: new THREE.Color(color), emissiveIntensity: 0.3,
      transparent: true, opacity: 0.5,
    });
    const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (const [dx, dz] of corners) {
      const accent = new THREE.Mesh(new THREE.CircleGeometry(0.15, 8), accentMat);
      accent.rotation.x = -Math.PI / 2;
      accent.position.set(cx + dx * (w * 0.35), 0.025, cz + dz * (h * 0.35));
      this.threeScene.add(accent);
    }

    // Central gathering circle
    const gatherGeo = new THREE.RingGeometry(0.5, 0.55, 32);
    const gatherMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.2 });
    const gather = new THREE.Mesh(gatherGeo, gatherMat);
    gather.rotation.x = -Math.PI / 2;
    gather.position.set(cx, 0.025, cz);
    this.threeScene.add(gather);
  }

  // ── Orca Pool: water surface, ripple ring ──
  private orcaWaterMesh: THREE.Mesh | null = null;

  private buildOrcaPoolDetails(cx: number, cz: number, w: number, h: number, _color: number) {
    // Animated water plane
    const waterGeo = new THREE.PlaneGeometry(w * 0.85, h * 0.85, 16, 16);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x004422, emissive: new THREE.Color(0x003318), emissiveIntensity: 0.3,
      transparent: true, opacity: 0.7,
      roughness: 0.2, metalness: 0.3,
    });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(cx, 0.025, cz);
    water.receiveShadow = true;
    this.threeScene.add(water);
    this.orcaWaterMesh = water;

    // Pool edge ring
    const edgeGeo = new THREE.RingGeometry(
      Math.min(w, h) * 0.38, Math.min(w, h) * 0.42, 32
    );
    const edgeMat = new THREE.MeshStandardMaterial({
      color: 0x006644, emissive: new THREE.Color(0x00ff88), emissiveIntensity: 0.2,
      transparent: true, opacity: 0.5,
    });
    const edge = new THREE.Mesh(edgeGeo, edgeMat);
    edge.rotation.x = -Math.PI / 2;
    edge.position.set(cx, 0.03, cz);
    this.threeScene.add(edge);
  }

  // ── Burn Furnace: charred ground, glowing red cracks ──
  private buildBurnFurnaceDetails(cx: number, cz: number, w: number, h: number, color: number) {
    // Charred ground
    const charMat = new THREE.MeshStandardMaterial({
      color: 0x1a0500, roughness: 1.0,
      transparent: true, opacity: 0.7,
    });
    const charred = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.85, h * 0.85), charMat);
    charred.rotation.x = -Math.PI / 2;
    charred.position.set(cx, 0.02, cz);
    charred.receiveShadow = true;
    this.threeScene.add(charred);

    // Glowing red cracks (random lines)
    const crackMat = new THREE.MeshStandardMaterial({
      color, emissive: new THREE.Color(color), emissiveIntensity: 0.8,
      transparent: true, opacity: 0.4,
    });
    const crackAngles = [0, 0.7, 1.5, 2.3, 3.1, 4.0, 5.2];
    for (const angle of crackAngles) {
      const len = 0.3 + Math.random() * 0.8;
      const crack = new THREE.Mesh(new THREE.PlaneGeometry(0.03, len), crackMat);
      crack.rotation.x = -Math.PI / 2;
      crack.rotation.z = angle;
      crack.position.set(
        cx + Math.cos(angle) * 0.3,
        0.025,
        cz + Math.sin(angle) * 0.3,
      );
      this.threeScene.add(crack);
    }

    // Central furnace glow
    const glowLight = new THREE.PointLight(0xff2200, 1.0, 5);
    glowLight.position.set(cx, 0.5, cz);
    this.threeScene.add(glowLight);

    // Ember particles
    const emberCount = 40;
    const ePos = new Float32Array(emberCount * 3);
    const eVel = new Float32Array(emberCount * 3);
    for (let i = 0; i < emberCount; i++) {
      ePos[i * 3]     = cx + (Math.random() - 0.5) * w * 0.6;
      ePos[i * 3 + 1] = Math.random() * 2;
      ePos[i * 3 + 2] = cz + (Math.random() - 0.5) * h * 0.6;
      eVel[i * 3]     = (Math.random() - 0.5) * 0.005;
      eVel[i * 3 + 1] = 0.005 + Math.random() * 0.01;
      eVel[i * 3 + 2] = (Math.random() - 0.5) * 0.005;
    }
    const eGeo = new THREE.BufferGeometry();
    eGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
    const eMat = new THREE.PointsMaterial({
      color: 0xff4400, size: 0.06, transparent: true, opacity: 0.8,
      sizeAttenuation: true, depthWrite: false,
    });
    const embers = new THREE.Points(eGeo, eMat);
    embers.frustumCulled = false;
    this.threeScene.add(embers);
    this.burnEmbers = { points: embers, velocities: eVel };
  }

  // ── Nova Bank: gold-trimmed marble floor, pillars ──
  private buildNovaBankDetails(cx: number, cz: number, w: number, h: number, color: number) {
    // Marble floor overlay
    const marbleMat = new THREE.MeshStandardMaterial({
      color: 0x1a1508, roughness: 0.3, metalness: 0.1,
      transparent: true, opacity: 0.6,
    });
    const marble = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.85, h * 0.85), marbleMat);
    marble.rotation.x = -Math.PI / 2;
    marble.position.set(cx, 0.02, cz);
    marble.receiveShadow = true;
    this.threeScene.add(marble);

    // Gold trim lines
    const trimMat = new THREE.MeshStandardMaterial({
      color, emissive: new THREE.Color(color), emissiveIntensity: 0.4,
      transparent: true, opacity: 0.5,
    });
    // Border inset
    const inset = 0.3;
    const iw = w * 0.85 - inset * 2, ih = h * 0.85 - inset * 2;
    const trimLines: [number, number, number, number][] = [
      [cx, cz - ih / 2, iw, 0.04],
      [cx, cz + ih / 2, iw, 0.04],
      [cx - iw / 2, cz, 0.04, ih],
      [cx + iw / 2, cz, 0.04, ih],
    ];
    for (const [tx, tz, tw, th] of trimLines) {
      const trim = new THREE.Mesh(new THREE.PlaneGeometry(tw, th), trimMat);
      trim.rotation.x = -Math.PI / 2;
      trim.position.set(tx, 0.025, tz);
      this.threeScene.add(trim);
    }

    // Corner pillars (decorative)
    const pillarGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.8, 8);
    const pillarMat = new THREE.MeshStandardMaterial({
      color, emissive: new THREE.Color(color), emissiveIntensity: 0.2,
      metalness: 0.5, roughness: 0.3,
    });
    const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (const [dx, dz] of corners) {
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      pillar.position.set(cx + dx * (iw / 2), 0.4, cz + dz * (ih / 2));
      pillar.castShadow = true;
      this.threeScene.add(pillar);
    }
  }

  /** Floating billboard labels — call after scene geometry is built */
  private createZoneLabels() {
    for (const [key, z] of Object.entries(ZONE_3D)) {
      const zone = ZONES[key];
      if (!zone) continue;
      const color = ZONE_COLORS[key] ?? 0x888888;

      // Canvas billboard
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 96;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, 512, 96);
      // Background bar
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.roundRect(8, 8, 496, 80, 12);
      ctx.fill();
      // Icon + label
      ctx.font = 'bold 36px "Space Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
      ctx.fillText(zone.icon + ' ' + zone.label, 256, 48);

      const tex = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.9, depthTest: false });
      const sprite = new THREE.Sprite(mat);
      sprite.position.set(z.cx, 2.4, z.cz - z.h / 2 - 0.3);
      sprite.scale.set(4.0, 0.75, 1);
      this.threeScene.add(sprite);
      this.zoneLabels.push(sprite);
    }
  }

  /** Road stripes between zones */
  private addRoadStripes() {
    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x222222, roughness: 0.95, metalness: 0,
    });
    const stripeMat = new THREE.MeshBasicMaterial({
      color: 0xffff44, transparent: true, opacity: 0.35,
    });
    for (const [a, b] of ROAD_SEGMENTS) {
      const dx = b.x - a.x, dz = b.y - a.y;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len < 0.01) continue;
      const angle = Math.atan2(dx, dz);
      const roadW = 1.4;
      // Road surface
      const roadGeo = new THREE.PlaneGeometry(roadW, len);
      const road = new THREE.Mesh(roadGeo, roadMat);
      road.rotation.x = -Math.PI / 2;
      road.rotation.z = -angle;
      road.position.set((a.x + b.x) / 2, 0.012, (a.y + b.y) / 2);
      road.receiveShadow = true;
      this.threeScene.add(road);
      // Centre dashes
      const dashCount = Math.floor(len / 0.8);
      for (let i = 0; i < dashCount; i++) {
        const t = (i + 0.5) / dashCount;
        const sx = a.x + dx * t, sz = a.y + dz * t;
        const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.3), stripeMat);
        dash.rotation.x = -Math.PI / 2;
        dash.rotation.z = -angle;
        dash.position.set(sx, 0.014, sz);
        this.threeScene.add(dash);
      }
    }
  }

  /** Spawn vehicles on ROAD_PATHS_3D loops */
  private async loadVehicles() {
    const carModels = ['sedan','sedanSports','truck','ambulance','delivery','taxi','police','van'];
    for (let i = 0; i < ROAD_PATHS_3D.length; i++) {
      const path = ROAD_PATHS_3D[i];
      const filename = carModels[i % carModels.length];
      try {
        const gltf = await this.loader.loadAsync('/kenney/models/cars/' + filename + '.glb');
        const model = gltf.scene;
        model.scale.setScalar(0.6);
        model.traverse(c => { if (c instanceof THREE.Mesh) { c.castShadow = true; } });
        this.threeScene.add(model);
        this.vehicles.push(new VehicleObject3D(model, path, 0));
      } catch {
        // Skip if model not found
      }
    }
  }

  // ── Colormap cache ─────────────────────────────────────────────────────────
  private colormaps = new Map<string, THREE.Texture>();

  private async getColormap(category: string): Promise<THREE.Texture | null> {
    if (this.colormaps.has(category)) return this.colormaps.get(category)!;
    try {
      const tex = await this.texLoader.loadAsync('/kenney/textures/' + category + '_colormap.png');
      tex.flipY = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      this.colormaps.set(category, tex);
      return tex;
    } catch {
      return null;
    }
  }

  // ── Asset loading ──────────────────────────────────────────────────────────

  async loadAssets(onProgress?: (pct: number) => void): Promise<void> {
    let loaded = 0;
    const totalSteps = Object.keys(ZONE_BUILDINGS).length + 10; // zones + vehicles + roads + city + life
    const bump = () => { loaded++; onProgress?.(Math.min(100, Math.round((loaded / totalSteps) * 100))); };

    console.log('[World3D] Starting asset load…');

    // Load buildings per zone (each zone uses its pack's colormap)
    await this.loadZoneBuildings(bump);
    console.log('[World3D] Zone buildings loaded');

    // Populate entire city — street grid + blocks + furniture
    await this.cityPopulator.populate((pct) => {
      onProgress?.(Math.min(100, Math.round(40 + pct * 0.4)));
    });
    console.log('[World3D] City grid populated');
    bump();

    // Spawn ambient NPCs on sidewalks + traffic on all roads
    await this.ambientLife.spawn(this.cityPopulator.roadSegments);
    // Chimney smoke
    this.ambientLife.createSmoke(this.cityPopulator.chimneyPositions);
    console.log('[World3D] Ambient life spawned');
    bump();

    // Custom Blender hero assets (graceful skip if not built)
    await this.loadCustomAssets();
    console.log('[World3D] Custom hero assets loaded');

    // Zone billboard labels (after buildings are placed)
    this.createZoneLabels();
    console.log('[World3D] Zone labels created');

    // Vehicles on inter-zone roads
    await this.loadVehicles();
    console.log('[World3D] Road vehicles spawned');

    this.sceneReady = true;
    console.log('[World3D] Scene ready — sceneReady = true');

    // Wire up weather panel in HUD
    this.hud?.createWeatherPanel(
      (w: WeatherState) => this.weather.setWeather(w),
      () => this.weather.getTimeOfDay(),
    );
    // Start with overcast as default (matches NovaOS dark aesthetic)
    this.weather.setWeather('overcast');
  }

  private async loadZoneBuildings(bump: () => void) {
    for (const [zoneKey, cfg] of Object.entries(ZONE_BUILDINGS)) {
      const z3d = ZONE_3D[zoneKey];
      if (!z3d) { bump(); continue; }

      const colormap = await this.getColormap(cfg.dir);
      const { cx, cz, w, h } = z3d;
      const zoneColor = ZONE_COLORS[zoneKey] ?? 0x888888;

      // Create layout grid for this zone
      const layout = new ZoneLayout(cx, cz, w, h, 2.0);
      this.zoneLayouts.set(zoneKey, layout);

      let placed = 0;
      for (const filename of cfg.files) {
        if (placed >= cfg.count) break;

        const slot = layout.nextSlot();
        if (!slot) break;

        const path = '/kenney/models/' + cfg.dir + '/' + filename + '.glb';
        try {
          const gltf = await this.loader.loadAsync(path);
          const model = gltf.scene;

          // Apply texture
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

          // Place at slot position — flush with ground, scaled to fit cell
          model.position.set(slot.x, GROUND_Y, slot.z);
          model.rotation.y = slot.rotation;
          model.scale.setScalar(0.7);

          this.threeScene.add(model);

          // Register bounding box for collision
          const box = new THREE.Box3().setFromObject(model);
          this.buildingBoxes.push(box);
          this.collision.addBuilding(`${zoneKey}_${placed}`, model);

          placed++;
        } catch (err) {
          console.warn('[World3D] Failed to load:', path, err);
          this.placeFallbackBuilding(slot.x, slot.z, zoneColor, 0.6 + Math.random() * 0.8);
        }
      }
      bump();
    }
  }

  private placeFallbackBuilding(x: number, z: number, color: number, height: number) {
    const geo = new THREE.BoxGeometry(0.5 + Math.random() * 0.4, height, 0.5 + Math.random() * 0.4);
    const mat = new THREE.MeshLambertMaterial({
      color: new THREE.Color(color).multiplyScalar(0.3),
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, height / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.threeScene.add(mesh);
  }

  // ── Custom Blender hero assets ─────────────────────────────────────────────

  private static readonly ZONE_HERO_ASSETS: Record<string, {
    file: string; scale?: number; yOffset?: number; rotateY?: number;
    secondaryProps?: Array<{ file: string; offsetX: number; offsetZ: number; scale?: number }>;
  }> = {
    trading_floor: {
      file: 'nova-tower', scale: 1.0,
      secondaryProps: [
        { file: 'lp-pool', offsetX: -1.2, offsetZ:  0.8, scale: 0.8 },
        { file: 'lp-pool', offsetX:  1.2, offsetZ: -0.8, scale: 0.6 },
        { file: 'crypto-atm', offsetX:  1.5, offsetZ:  1.0, scale: 0.7 },
        { file: 'crypto-atm', offsetX: -1.5, offsetZ: -1.0, scale: 0.7 },
      ],
    },
    intel_hub: {
      file: 'satellite-array', scale: 1.0,
      secondaryProps: [
        { file: 'data-pillar', offsetX: -0.8, offsetZ: 0.5 },
        { file: 'data-pillar', offsetX:  0.8, offsetZ: -0.5 },
      ],
    },
    command_center: { file: 'nova-hq', scale: 1.1 },
    launchpad: {
      file: 'launch-pad', scale: 1.0,
      secondaryProps: [{ file: 'rocket', offsetX: 0, offsetZ: 0, scale: 1.0 }],
    },
    watchtower:    { file: 'guard-tower', scale: 1.0 },
    agora: {
      file: 'agora-plaza', scale: 1.0,
      secondaryProps: [
        { file: 'crypto-atm', offsetX: 1.0, offsetZ: 0.5, scale: 0.7 },
      ],
    },
    burn_furnace:  { file: 'burn-furnace', scale: 1.0 },
    nova_bank:     { file: 'nova-bank', scale: 1.0, rotateY: 180 },
  };

  private async loadCustomAssets(): Promise<void> {
    for (const [zoneKey, hero] of Object.entries(World3D.ZONE_HERO_ASSETS)) {
      const z3d = ZONE_3D[zoneKey];
      if (!z3d) continue;
      const { cx, cz } = z3d;

      const heroPath = `/kenney/models/custom/${hero.file}.glb`;
      try {
        const gltf = await this.loader.loadAsync(heroPath);
        const model = gltf.scene;
        model.traverse(child => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        model.scale.setScalar(hero.scale ?? 1.0);
        model.position.set(cx, hero.yOffset ?? 0, cz);
        if (hero.rotateY) model.rotation.y = THREE.MathUtils.degToRad(hero.rotateY);
        this.threeScene.add(model);
        this.collision.addBuilding(`hero_${zoneKey}`, model);

        if (hero.secondaryProps) {
          for (const prop of hero.secondaryProps) {
            try {
              const pg = await this.loader.loadAsync(`/kenney/models/custom/${prop.file}.glb`);
              const pm = pg.scene;
              pm.scale.setScalar(prop.scale ?? 1.0);
              pm.position.set(cx + prop.offsetX, 0, cz + prop.offsetZ);
              pm.traverse(c => { if (c instanceof THREE.Mesh) c.castShadow = true; });
              this.threeScene.add(pm);
              this.collision.addBuilding(`prop_${zoneKey}_${prop.file}`, pm);
            } catch { /* prop not built yet */ }
          }
        }
      } catch {
        console.debug(`[World3D] Custom asset not found: ${heroPath} (run npm run build:assets)`);
      }
    }
  }

  // ── Agent spawning ────────────────────────────────────────────────────────

  async spawnAgent(agentId: string): Promise<void> {
    if (this.agents.has(agentId)) return;

    const cfg = AGENT_MODELS[agentId];
    if (!cfg) return;

    const def = AGENT_DEFS[agentId];
    const z3d = def?.zone ? ZONE_3D[def.zone] : null;
    const cx = z3d ? z3d.cx : 0;
    const cz = z3d ? z3d.cz : 0;

    // Use zone layout to find a valid spawn point (clear of buildings)
    const layout = (def?.zone) ? this.zoneLayouts.get(def.zone) : null;
    const spawnPoints = layout ? layout.getAgentSpawnPoints(cx, cz, 3) : [new THREE.Vector3(cx, 0, cz)];
    const spawn = spawnPoints[this.agents.size % spawnPoints.length];

    // Resolve against collision world for a clear spot
    const clearSpawn = this.collision.findClearSpawn(
      new THREE.Vector3(spawn.x, 0, spawn.z), 0.4
    );

    try {
      const charLetter = cfg.model.replace('character-', '');
      const [gltf, tex] = await Promise.all([
        this.loader.loadAsync('/kenney/models/characters/' + cfg.model + '.glb'),
        this.texLoader.loadAsync('/kenney/textures/texture-' + charLetter + '.png')
          .then(t => { t.flipY = false; return t; })
          .catch(() => null as THREE.Texture | null),
      ]);

      const agent = await AgentObject3D.load(
        this.threeScene, agentId, gltf, tex, cfg.color, cfg.cssColor,
        clearSpawn.x, clearSpawn.z
      );

      // Add name label above agent
      this.addAgentLabel(def?.label ?? agentId, agent.model, cfg.color);

      this.mixers.push(agent.mixer);
      agent.state.currentZone = def?.zone ?? '';
      this.agents.set(agentId, agent);
      this.clickables.push({ mesh: agent.model, type: 'agent', id: agentId });
    } catch (e) {
      console.warn(`[World3D] Failed to spawn ${agentId}`, e);
      // Fallback procedural agent
      const model = this.createFallbackAgent(cfg.color);
      model.position.set(clearSpawn.x, GROUND_Y, clearSpawn.z);
      this.threeScene.add(model);
      this.addAgentLabel(def?.label ?? agentId, model, cfg.color);

      const mixer = new THREE.AnimationMixer(model);
      const agent = new AgentObject3D(agentId, model, mixer, null, null, cfg.color, cfg.cssColor);
      agent.state.currentZone = def?.zone ?? '';
      this.agents.set(agentId, agent);
      this.clickables.push({ mesh: model, type: 'agent', id: agentId });
    }
  }

  private createFallbackAgent(color: number): THREE.Group {
    const group = new THREE.Group();

    // Body capsule (cylinder + sphere head)
    const bodyGeo = new THREE.CylinderGeometry(0.12, 0.14, 0.4, 8);
    const bodyMat = new THREE.MeshLambertMaterial({ color });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.25;
    body.castShadow = true;
    group.add(body);

    // Head sphere
    const headGeo = new THREE.SphereGeometry(0.12, 8, 6);
    const head = new THREE.Mesh(headGeo, bodyMat);
    head.position.y = 0.55;
    head.castShadow = true;
    group.add(head);

    // Eyes
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const eyeGeo = new THREE.SphereGeometry(0.025, 4, 4);
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.05, 0.57, 0.1);
    group.add(eyeL);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeR.position.set(0.05, 0.57, 0.1);
    group.add(eyeR);

    // Shadow ellipse
    const shadowGeo = new THREE.CircleGeometry(0.15, 8);
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 });
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.01;
    group.add(shadow);

    return group;
  }

  private addAgentLabel(name: string, parent: THREE.Object3D, color: number) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 32;
    const ctx = canvas.getContext('2d')!;
    ctx.font = '14px "Space Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
    ctx.fillText(name.replace('Nova ', ''), 64, 16);

    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.85 });
    const sprite = new THREE.Sprite(mat);
    sprite.position.y = 0.9;
    sprite.scale.set(1.2, 0.3, 1);
    parent.add(sprite);
  }

  // ── Sync agents from API ──────────────────────────────────────────────────

  syncAgents(agentList: Array<{ agentId: string; status: string; messages24h: number; currentZone?: string | null }>) {
    if (!this.sceneReady) return;

    // If no agents from API, spawn all known agents as fallback
    const list = agentList.length > 0
      ? agentList
      : Object.keys(AGENT_MODELS).map(id => ({ agentId: id, status: 'running', messages24h: 0, currentZone: null }));

    for (const a of list) {
      if (!this.agents.has(a.agentId)) {
        this.spawnAgent(a.agentId); // async, fire-and-forget
      }
      const agent = this.agents.get(a.agentId);
      if (agent) {
        agent.setStatus(a.status);
        agent.state.messages24h = a.messages24h;
        if (a.currentZone) agent.state.currentZone = a.currentZone;
      }
    }
  }

  // ── Handle live events ────────────────────────────────────────────────────

  handleEvent(event: UniverseEvent) {
    const agent = this.findAgent(event.agent);
    if (!agent) return;

    agent.flash();
    agent.showAction(event.icon, event.msg, agent.cssColor);

    // Move agent to event's target zone
    const zoneKey = ACTION_ZONE_MAP[event.action];
    if (zoneKey) {
      const z3d = ZONE_3D[zoneKey];
      if (z3d) {
        const tx = z3d.cx + (Math.random() - 0.5) * (z3d.w * 0.5);
        const tz = z3d.cz + (Math.random() - 0.5) * (z3d.h * 0.5);
        agent.walkTo(tx, tz, this.collision);
        agent.state.currentZone = zoneKey;

        // Zone entry flash — pulse the zone light
        this.flashZoneBorder(zoneKey);
      }
    }

    // Particle burst
    this.emitParticles(agent.model.position, agent.color);
  }

  /** Replay a historical event (from timeline scrubber) */
  replayEvent(event: UniverseEvent) {
    this.handleEvent(event); // same visual logic
  }

  private findAgent(name: string): AgentObject3D | null {
    if (this.agents.has(name)) return this.agents.get(name)!;
    const lower = name.toLowerCase();
    for (const [id, agent] of this.agents) {
      if (id.includes(lower) || lower.includes(id.replace('nova-', ''))) return agent;
    }
    return null;
  }

  // ── Zone border flash effect ─────────────────────────────────────────────

  private flashZoneBorder(zoneKey: string) {
    const light = this.zoneLights.get(zoneKey);
    if (!light) return;
    const originalIntensity = light.intensity;
    const originalDistance = light.distance;
    light.intensity = 5;
    light.distance = 20;
    // Quick flash then fade back
    const start = performance.now();
    const flashTick = () => {
      const elapsed = (performance.now() - start) / 1000;
      if (elapsed > 0.6) {
        light.intensity = originalIntensity;
        light.distance = originalDistance;
        return;
      }
      const t = elapsed / 0.6;
      light.intensity = 5 * (1 - t) + originalIntensity * t;
      light.distance = 20 * (1 - t) + originalDistance * t;
      requestAnimationFrame(flashTick);
    };
    requestAnimationFrame(flashTick);
  }

  // ── Particles ─────────────────────────────────────────────────────────────

  private emitParticles(origin: THREE.Vector3, color: number) {
    const count = 12;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities: THREE.Vector3[] = [];

    for (let i = 0; i < count; i++) {
      positions[i * 3]     = origin.x;
      positions[i * 3 + 1] = origin.y + 0.5;
      positions[i * 3 + 2] = origin.z;
      velocities.push(new THREE.Vector3(
        (Math.random() - 0.5) * 0.15,
        Math.random() * 0.2 + 0.05,
        (Math.random() - 0.5) * 0.15,
      ));
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(geo, new THREE.PointsMaterial({
      color, size: 0.12, transparent: true, opacity: 1,
    }));
    this.threeScene.add(points);

    let life = 0;
    const tick = () => {
      life += 0.04;
      const pos = geo.attributes.position.array as Float32Array;
      for (let i = 0; i < count; i++) {
        pos[i * 3]     += velocities[i].x;
        pos[i * 3 + 1] += velocities[i].y;
        pos[i * 3 + 2] += velocities[i].z;
        velocities[i].y -= 0.008; // gravity
      }
      geo.attributes.position.needsUpdate = true;
      (points.material as THREE.PointsMaterial).opacity = 1 - life;

      if (life < 1) {
        requestAnimationFrame(tick);
      } else {
        this.threeScene.remove(points);
        geo.dispose();
        (points.material as THREE.PointsMaterial).dispose();
      }
    };
    tick();
  }

  // ── Camera ────────────────────────────────────────────────────────────────

  private updateCamera() {
    this.camera.position.copy(this.camTargetSmooth).add(this.camOffsetSmooth);
    this.camera.lookAt(this.camTargetSmooth);
  }

  /** Smoothly interpolate camera toward target each frame */
  private lerpCamera(delta: number) {
    const lerpFactor = 1 - Math.pow(0.001, delta); // ~smooth at any framerate
    this.camTargetSmooth.lerp(this.camTarget, lerpFactor);
    this.camOffsetSmooth.lerp(this.camOffset, lerpFactor);
    this.updateCamera();
  }

  private setupControls(canvas: HTMLCanvasElement) {
    // Mouse drag to pan
    canvas.addEventListener('mousedown', e => {
      if (e.button === 0) { this.isDragging = true; this.lastMouse = { x: e.clientX, y: e.clientY }; }
    });
    canvas.addEventListener('mouseup', () => { this.isDragging = false; });
    canvas.addEventListener('mousemove', e => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.lastMouse.x;
      const dy = e.clientY - this.lastMouse.y;
      this.camTarget.x += dx * this.panSpeed;
      this.camTarget.z += dy * this.panSpeed;
      this.lastMouse = { x: e.clientX, y: e.clientY };
    });

    // Scroll to zoom (scroll up = zoom in, scroll down = zoom out)
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      this.camOffset.multiplyScalar(e.deltaY > 0 ? 1.1 : 0.9);
      this.camOffset.y = Math.max(5, Math.min(50, this.camOffset.y));
      this.camOffset.z = Math.max(3, Math.min(45, this.camOffset.z));
      this.updateCamera();
    }, { passive: false });

    // Keyboard
    window.addEventListener('keydown', e => { this.keys.add(e.key); this.handleKeydown(e); });
    window.addEventListener('keyup', e => { this.keys.delete(e.key); });

    // Click to select
    canvas.addEventListener('click', e => this.handleClick(e, canvas));

    // Touch support
    canvas.addEventListener('touchstart', e => {
      const t = e.touches[0];
      this.isDragging = true;
      this.lastMouse = { x: t.clientX, y: t.clientY };
    });
    canvas.addEventListener('touchend', () => { this.isDragging = false; });
    canvas.addEventListener('touchmove', e => {
      const t = e.touches[0];
      const dx = t.clientX - this.lastMouse.x;
      const dy = t.clientY - this.lastMouse.y;
      this.camTarget.x += dx * this.panSpeed;
      this.camTarget.z += dy * this.panSpeed;
      this.lastMouse = { x: t.clientX, y: t.clientY };
    });
  }

  private handleKeydown(e: KeyboardEvent) {
    // Number keys 1-7 → focus agent, 0 → world centre
    const AGENT_ORDER = Object.keys(AGENT_MODELS);
    const num = parseInt(e.key);
    if (num >= 1 && num <= 7) {
      const agentId = AGENT_ORDER[num - 1];
      this.focusAgent(agentId);
    }
    if (e.key === '0') {
      this.camTarget.set(0, 0, 0);
      this.updateCamera();
    }
  }

  private handleClick(e: MouseEvent, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width)  *  2 - 1,
      ((e.clientY - rect.top)  / rect.height) * -2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);

    // Gather all clickable meshes
    const allMeshes: THREE.Object3D[] = [];
    this.clickables.forEach(c => {
      c.mesh.traverse(o => { if (o instanceof THREE.Mesh) allMeshes.push(o); });
    });

    const hits = this.raycaster.intersectObjects(allMeshes);
    if (hits.length === 0) return;

    const hitObj = hits[0].object;
    const entry = this.clickables.find(c => {
      let match = false;
      c.mesh.traverse(o => { if (o === hitObj) match = true; });
      return match;
    });

    if (!entry) return;

    if (entry.type === 'agent') {
      this.onAgentClicked(entry.id);
    } else if (entry.type === 'zone') {
      this.onZoneClicked(entry.id);
    }
  }

  // ── Agent click handler ───────────────────────────────────────────────────

  private async onAgentClicked(agentId: string) {
    const agent = this.agents.get(agentId);
    const def = AGENT_DEFS[agentId];
    if (!agent || !def) return;

    // Show tooltip immediately with loading state
    this.hud?.showAgentTooltip({
      name: def.label,
      role: def.role,
      emoji: def.emoji,
      color: def.cssColor,
      status: agent.state.status,
      messages24h: agent.state.messages24h,
      zone: agent.state.currentZone,
      messages: ['Loading…'],
    });

    // Focus camera on agent
    this.camTarget.copy(agent.model.position);
    this.updateCamera();

    // Fetch last messages for this agent
    try {
      const feed: any[] = await apiFetch('/feed?limit=30');
      const agentSlug = agentId.replace('nova-', '').toUpperCase();
      const msgs = (Array.isArray(feed) ? feed : [])
        .filter((item: any) =>
          (item.agent ?? '').toUpperCase().includes(agentSlug) ||
          item.agentSlug === agentId
        )
        .slice(0, 5)
        .map((item: any) => (item.icon ?? '🤖') + ' ' + (item.msg ?? item.summary ?? '...'));

      this.hud?.showAgentTooltip({
        name: def.label,
        role: def.role,
        emoji: def.emoji,
        color: def.cssColor,
        status: agent.state.status,
        messages24h: agent.state.messages24h,
        zone: agent.state.currentZone,
        messages: msgs.length > 0 ? msgs : ['No recent activity'],
      });
    } catch { /* tooltip already showing */ }
  }

  // ── Zone click handler ────────────────────────────────────────────────────

  private async onZoneClicked(zoneKey: string) {
    const zone = ZONES[zoneKey];
    const z3d = ZONE_3D[zoneKey];
    if (!zone || !z3d) return;

    const color = '#' + (ZONE_COLORS[zoneKey] ?? 0x888888).toString(16).padStart(6, '0');
    this.hud?.showZonePanel(zoneKey, zone.icon + ' ' + zone.label, color);

    // Focus camera on zone
    this.camTarget.set(z3d.cx, 0, z3d.cz);
    this.updateCamera();

    // Fetch zone-specific data
    try {
      let html = '';
      if (zoneKey === 'trading_floor' || zoneKey === 'orca_pool') {
        const data = await apiFetch('/portfolio');
        const positions = data?.positions ?? [];
        html = positions.length
          ? positions.slice(0, 5).map((p: any) =>
              '<div style="padding:6px 0;border-bottom:1px solid #111">' +
              '<div style="color:#fff">' + (p.protocol ?? p.strategy_tag ?? 'Position') + '</div>' +
              '<div style="color:#555">$' + (p.value_usd ?? 0).toFixed(2) + ' · ' + (p.chain ?? '') + '</div>' +
              '</div>').join('')
          : '<div style="color:#333;padding:12px 0">No open positions</div>';
      } else if (zoneKey === 'intel_hub') {
        const data = await apiFetch('/feed?limit=6');
        const items = Array.isArray(data) ? data : [];
        html = items.map((item: any) =>
          '<div style="padding:6px 0;border-bottom:1px solid #111">' +
          '<div style="color:' + (item.color ?? '#888') + '">' + (item.icon ?? '') + ' ' + (item.agent ?? '') + '</div>' +
          '<div style="color:#aaa;margin-top:2px">' + (item.msg ?? '') + '</div>' +
          '</div>').join('');
      } else if (zoneKey === 'watchtower') {
        const data = await apiFetch('/health/overview');
        html = '<div style="padding:6px 0;border-bottom:1px solid #111">' +
          '<div style="color:#fff">System Status</div>' +
          '<div style="color:' + (data?.status === 'healthy' ? '#00ff88' : '#ff9500') + '">' + (data?.status ?? 'unknown') + '</div></div>' +
          '<div style="padding:6px 0"><div style="color:#555">Errors 24h</div><div style="color:#fff">' + (data?.errors_24h ?? 0) + '</div></div>';
      } else if (zoneKey === 'launchpad') {
        const data = await apiFetch('/launches?limit=5');
        const items = Array.isArray(data) ? data : [];
        html = items.map((l: any) =>
          '<div style="padding:6px 0;border-bottom:1px solid #111">' +
          '<div style="color:#f472b6">' + (l.data?.name ?? (l.id ?? '').toString().slice(0, 8)) + '</div>' +
          '<div style="color:#555">' + (l.launch_status ?? 'pending') + '</div></div>').join('');
      } else if (zoneKey === 'agora') {
        const data = await apiFetch('/governance/proposals');
        const items = (data?.proposals ?? data ?? []);
        html = (Array.isArray(items) ? items : []).slice(0, 4).map((p: any) =>
          '<div style="padding:6px 0;border-bottom:1px solid #111">' +
          '<div style="color:#ffd700">' + (p.title ?? 'Proposal') + '</div>' +
          '<div style="color:#555">' + (p.status ?? '') + ' · ' + (p.votes_for ?? 0) + ' for / ' + (p.votes_against ?? 0) + ' against</div></div>').join('');
      } else if (zoneKey === 'burn_furnace') {
        const data = await apiFetch('/burn/stats');
        html = '<div style="padding:6px 0;border-bottom:1px solid #111"><div style="color:#555">Total SOL Burned</div><div style="color:#ff4444">' + (data?.totalSolBurned ?? '0.00') + ' SOL</div></div>' +
          '<div style="padding:6px 0;border-bottom:1px solid #111"><div style="color:#555">Total Burns</div><div style="color:#fff">' + (data?.totalBurns ?? 0) + '</div></div>' +
          '<div style="padding:6px 0"><div style="color:#555">Credits Issued</div><div style="color:#00ff88">' + (data?.totalCredits ?? 0) + '</div></div>';
      } else if (zoneKey === 'command_center') {
        const data = await apiFetch('/supervisor/status');
        html = '<div style="padding:6px 0;border-bottom:1px solid #111"><div style="color:#555">Active Agents</div><div style="color:#c084fc">' + (data?.active_agents ?? 0) + '</div></div>' +
          '<div style="padding:6px 0"><div style="color:#555">Last Decision</div><div style="color:#aaa;margin-top:2px">' + (data?.last_decision ?? 'None') + '</div></div>';
      }

      this.hud?.updateZonePanelContent(html || '<div style="color:#333;padding:12px 0">No data</div>');
    } catch {
      this.hud?.updateZonePanelContent('<div style="color:#333;padding:12px 0">Failed to load</div>');
    }
  }

  // ── Tick (called every frame) ─────────────────────────────────────────────

  tick() {
    const delta = this.clock.getDelta(); // ONLY call once per frame

    // Feed camera height so fog thins when zoomed out
    this.weather.setCameraHeight(this.camOffsetSmooth.y);

    // Update weather system (time of day + rain + lightning)
    this.weather.update(delta);

    // WASD camera pan (use speed * delta for frame-rate independence)
    const speed = 6 * delta;
    if (this.keys.has('ArrowUp') || this.keys.has('w'))    { this.camTarget.z -= speed; }
    if (this.keys.has('ArrowDown') || this.keys.has('s'))  { this.camTarget.z += speed; }
    if (this.keys.has('ArrowLeft') || this.keys.has('a'))  { this.camTarget.x -= speed; }
    if (this.keys.has('ArrowRight') || this.keys.has('d')) { this.camTarget.x += speed; }

    // Smooth camera interpolation
    this.lerpCamera(delta);

    // Update animation mixers
    for (const m of this.mixers) m.update(delta);

    // Agent animations — idle sway/look-around + walking bob
    const time = performance.now() * 0.001;
    for (const [, agent] of this.agents) {
      if (!agent.state.isWalking) {
        // Idle: gentle breathing sway + occasional head turn
        const idlePhase = time * 0.8 + agent.color * 0.02;
        agent.model.rotation.z = Math.sin(idlePhase) * 0.015;
        agent.model.rotation.x = 0;
        // Slow look-around: agent faces different direction over time
        const lookPhase = time * 0.15 + agent.color * 0.1;
        agent.model.rotation.y = Math.sin(lookPhase) * 0.4;
        // Subtle hover/breathing on Y
        agent.model.position.y = GROUND_Y + Math.sin(idlePhase * 1.3) * 0.008;
      } else {
        // Walking: purposeful lean + bounce
        agent.model.rotation.z = Math.sin(time * 6) * 0.04;
        agent.model.rotation.x = 0.05;
        agent.model.position.y = GROUND_Y + Math.abs(Math.sin(time * 8)) * 0.015;
      }
      agent.updateBubble(this.camera);
    }

    // Update ambient life (NPCs, traffic, smoke)
    this.ambientLife.tick(delta);

    // Zone light pulse — glow brighter at night (cyberpunk neon beacon effect)
    const tod = this.weather.getTimeOfDay();
    const isNight = tod < 6 || tod > 19;
    const nightTransition = (tod >= 6 && tod <= 7) ? (7 - tod) : (tod >= 18 && tod <= 19) ? (tod - 18) : isNight ? 1.0 : 0.0;
    const zoneLightMul = 1.0 + nightTransition * 1.5;
    for (const [, zl] of this.zoneLights) {
      zl.intensity = (0.6 + Math.sin(time * 1.2 + zl.color.getHex() * 0.0001) * 0.25) * zoneLightMul;
      zl.distance = isNight ? 14 : 8;
    }

    // Zone edge bars glow at night
    const edgeGlow = 0.6 + nightTransition * 1.2;
    for (const mat of this.zoneEdgeMats) {
      mat.emissiveIntensity = edgeGlow;
      mat.opacity = 0.7 + nightTransition * 0.3;
    }

    // Orca Pool water animation
    if (this.orcaWaterMesh) {
      const wPos = this.orcaWaterMesh.geometry.attributes.position;
      const wArr = wPos.array as Float32Array;
      for (let i = 0; i < wPos.count; i++) {
        const wx = wArr[i * 3], wy = wArr[i * 3 + 1];
        wArr[i * 3 + 2] = Math.sin(wx * 3 + time * 1.5) * 0.015 + Math.cos(wy * 4 + time * 1.2) * 0.01;
      }
      wPos.needsUpdate = true;
    }

    // Burn Furnace ember particles — drift upward, reset when too high
    if (this.burnEmbers) {
      const bz = ZONE_3D.burn_furnace;
      const ePos = this.burnEmbers.points.geometry.attributes.position.array as Float32Array;
      const eVel = this.burnEmbers.velocities;
      const eCount = ePos.length / 3;
      for (let i = 0; i < eCount; i++) {
        ePos[i * 3]     += eVel[i * 3] + Math.sin(time + i) * 0.002;
        ePos[i * 3 + 1] += eVel[i * 3 + 1];
        ePos[i * 3 + 2] += eVel[i * 3 + 2];
        if (ePos[i * 3 + 1] > 3) {
          ePos[i * 3]     = bz.cx + (Math.random() - 0.5) * bz.w * 0.6;
          ePos[i * 3 + 1] = 0.1;
          ePos[i * 3 + 2] = bz.cz + (Math.random() - 0.5) * bz.h * 0.6;
        }
      }
      this.burnEmbers.points.geometry.attributes.position.needsUpdate = true;
      (this.burnEmbers.points.material as THREE.PointsMaterial).opacity = 0.5 + Math.sin(time * 2) * 0.3;
    }

    // Launchpad spark particles — rise and reset
    if (this.launchSparks) {
      const lz = ZONE_3D.launchpad;
      const sPos = this.launchSparks.points.geometry.attributes.position.array as Float32Array;
      const sVel = this.launchSparks.velocities;
      const sCount = sPos.length / 3;
      for (let i = 0; i < sCount; i++) {
        sPos[i * 3]     += sVel[i * 3];
        sPos[i * 3 + 1] += sVel[i * 3 + 1];
        sPos[i * 3 + 2] += sVel[i * 3 + 2];
        if (sPos[i * 3 + 1] > 4) {
          sPos[i * 3]     = lz.cx + (Math.random() - 0.5) * 1.2;
          sPos[i * 3 + 1] = 0.1;
          sPos[i * 3 + 2] = lz.cz + (Math.random() - 0.5) * 1.2;
        }
      }
      this.launchSparks.points.geometry.attributes.position.needsUpdate = true;
    }

    // Update inter-zone vehicles
    for (const v of this.vehicles) v.update(delta, this.collision);

    // Update sky uniforms from weather
    if (this.skyUniforms) {
      this.weather.updateSky(this.skyUniforms);
    }

    // Animate atmosphere particles
    if (this.atmospherePoints && this.atmosphereVelocities) {
      const aPos = this.atmospherePoints.geometry.attributes.position.array as Float32Array;
      const aVel = this.atmosphereVelocities;
      const count = aPos.length / 3;
      for (let i = 0; i < count; i++) {
        aPos[i * 3]     += aVel[i * 3];
        aPos[i * 3 + 1] += aVel[i * 3 + 1];
        aPos[i * 3 + 2] += aVel[i * 3 + 2];
        if (aPos[i * 3] > 30) aPos[i * 3] = -30;
        if (aPos[i * 3] < -30) aPos[i * 3] = 30;
        if (aPos[i * 3 + 2] > 30) aPos[i * 3 + 2] = -30;
        if (aPos[i * 3 + 2] < -30) aPos[i * 3 + 2] = 30;
        if (aPos[i * 3 + 1] > 12) aPos[i * 3 + 1] = 0.3;
        if (aPos[i * 3 + 1] < 0.3) aPos[i * 3 + 1] = 12;
      }
      this.atmospherePoints.geometry.attributes.position.needsUpdate = true;
    }

    // Render
    this.renderer.render(this.threeScene, this.camera);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  getAgentCount() { return this.agents.size; }

  focusAgent(agentId: string) {
    const agent = this.agents.get(agentId);
    if (agent) {
      this.camTarget.copy(agent.model.position);
      this.updateCamera();
    }
  }

  focusZone(zoneKey: string) {
    const z3d = ZONE_3D[zoneKey];
    if (!z3d) return;
    this.camTarget.set(z3d.cx, 0, z3d.cz);
    this.updateCamera();
  }
}
