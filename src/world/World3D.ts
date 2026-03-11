import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ZONES, AGENT_DEFS, WORLD_WIDTH, WORLD_HEIGHT, ACTION_ZONE_MAP } from '../config/constants';
import { AgentObject3D } from './AgentObject3D';
import { CityPopulator } from './CityPopulator';
import { AmbientLife } from './AmbientLife';
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
  trading_floor:  { dir: 'commercial',  files: ['building-skyscraper-a','building-skyscraper-b','building-skyscraper-c','building-c','building-d'], count: 5 },
  intel_hub:      { dir: 'commercial',  files: ['building-e','building-f','building-g','building-h','low-detail-building-c'], count: 4 },
  watchtower:     { dir: 'industrial',  files: ['building-a','building-b','building-c','chimney-large','chimney-medium'], count: 4 },
  command_center: { dir: 'commercial',  files: ['building-skyscraper-d','building-skyscraper-e','building-a','building-b'], count: 4 },
  launchpad:      { dir: 'industrial',  files: ['building-h','building-i','building-j','building-k','detail-tank'], count: 4 },
  agora:          { dir: 'suburban',    files: ['building-type-a','building-type-b','building-type-c','building-type-d','tree-large','tree-small'], count: 5 },
  orca_pool:      { dir: 'commercial',  files: ['low-detail-building-a','low-detail-building-b','low-detail-building-d','low-detail-building-e'], count: 4 },
  burn_furnace:   { dir: 'industrial',  files: ['chimney-large','chimney-small','chimney-basic','detail-tank','building-d','building-e'], count: 5 },
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
};

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

  // Camera control state
  private camTarget = new THREE.Vector3(0, 0, 0);
  private camOffset = new THREE.Vector3(0, CAM_HEIGHT, CAM_HEIGHT * 0.8);
  private isDragging = false;
  private lastMouse = { x: 0, y: 0 };
  private panSpeed = 0.05;
  private keys = new Set<string>();

  // Raycasting for click detection
  private raycaster = new THREE.Raycaster();
  private clickables: Array<{ mesh: THREE.Object3D; type: 'agent' | 'zone'; id: string }> = [];

  // Fallback building geometry (used if GLB not found)
  private fallbackGeo = new THREE.BoxGeometry(0.6, 1.2, 0.6);

  private sceneReady = false;

  // ── Constructor ─────────────────────────────────────────────────────────────

  constructor(canvas: HTMLCanvasElement) {
    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x0a0a0f);

    // Scene
    this.threeScene = new THREE.Scene();
    this.threeScene.fog = new THREE.FogExp2(0x0a0c14, 0.012);

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
    this.threeScene.add(new THREE.AmbientLight(0x334466, 1.8));

    // Main directional — warm sunlight
    const sun = new THREE.DirectionalLight(0xfff0d0, 3.0);
    sun.position.set(20, 40, 15);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 0.1;
    sun.shadow.camera.far = 120;
    sun.shadow.camera.left = -35;
    sun.shadow.camera.right = 35;
    sun.shadow.camera.top = 35;
    sun.shadow.camera.bottom = -35;
    this.threeScene.add(sun);

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
    gctx.fillStyle = '#1a1c22';
    gctx.fillRect(0, 0, 512, 512);

    // Subtle noise for asphalt texture
    for (let i = 0; i < 8000; i++) {
      const nx = Math.random() * 512;
      const ny = Math.random() * 512;
      const brightness = 20 + Math.floor(Math.random() * 15);
      gctx.fillStyle = `rgb(${brightness},${brightness + 2},${brightness + 5})`;
      gctx.fillRect(nx, ny, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }

    // Faint grid lines every 32px
    gctx.strokeStyle = 'rgba(60,65,80,0.15)';
    gctx.lineWidth = 1;
    for (let i = 0; i < 512; i += 32) {
      gctx.beginPath(); gctx.moveTo(i, 0); gctx.lineTo(i, 512); gctx.stroke();
      gctx.beginPath(); gctx.moveTo(0, i); gctx.lineTo(512, i); gctx.stroke();
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

    // === Subtle grid overlay (dimmer) ===
    const gridHelper = new THREE.GridHelper(60, 60, 0x222233, 0x16161e);
    gridHelper.position.y = 0.015;
    gridHelper.material.opacity = 0.3;
    (gridHelper.material as THREE.Material).transparent = true;
    this.threeScene.add(gridHelper);

    // Zone floor pads + borders + accent lights
    this.addZonePads();

    // === Sky dome (gradient hemisphere) ===
    this.buildSkyDome();

    // === Floating atmosphere particles ===
    this.buildAtmosphere();
  }

  /** Gradient sky dome so the background isn't flat black */
  private buildSkyDome() {
    const skyGeo = new THREE.SphereGeometry(90, 32, 16);
    // Vertex colours: dark blue at top → dark purple at horizon
    const colours = new Float32Array(skyGeo.attributes.position.count * 3);
    const pos = skyGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const t = THREE.MathUtils.clamp((y + 90) / 180, 0, 1); // 0 = bottom, 1 = top
      // Bottom: dark ground color → Top: deep night sky
      const r = THREE.MathUtils.lerp(0.04, 0.03, t);
      const g = THREE.MathUtils.lerp(0.04, 0.04, t);
      const b = THREE.MathUtils.lerp(0.06, 0.10, t);
      colours[i * 3]     = r;
      colours[i * 3 + 1] = g;
      colours[i * 3 + 2] = b;
    }
    skyGeo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    const skyMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      fog: false,
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

  // Roads are now built by CityPopulator.buildStreetGrid()

  private addZonePads() {
    Object.entries(ZONES).forEach(([key, zone]) => {
      const color = ZONE_COLORS[key] ?? 0x333333;
      const wx = zone.x * SCALE - WORLD_CX;
      const wz = zone.y * SCALE - WORLD_CZ;
      const ww = zone.w * SCALE;
      const wh = zone.h * SCALE;

      // Zone floor pad
      const padGeo = new THREE.PlaneGeometry(ww, wh);
      const padMat = new THREE.MeshLambertMaterial({
        color: new THREE.Color(color).multiplyScalar(0.08),
        transparent: true,
        opacity: 0.9,
      });
      const pad = new THREE.Mesh(padGeo, padMat);
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(wx, 0.015, wz);
      pad.receiveShadow = true;
      this.threeScene.add(pad);

      // Glowing border
      const borderGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-ww / 2, 0, -wh / 2),
        new THREE.Vector3( ww / 2, 0, -wh / 2),
        new THREE.Vector3( ww / 2, 0,  wh / 2),
        new THREE.Vector3(-ww / 2, 0,  wh / 2),
      ]);
      const border = new THREE.LineLoop(
        borderGeo,
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5 }),
      );
      border.position.set(wx, 0.03, wz);
      this.threeScene.add(border);

      // Zone accent point light
      const light = new THREE.PointLight(color, 0.6, 8);
      light.position.set(wx, 1.5, wz);
      this.threeScene.add(light);

      // Zone label (floating sprite)
      this.addZoneLabel(zone.icon + ' ' + zone.label, wx, wz, color);

      // Invisible click zone (a flat box)
      const clickPad = new THREE.Mesh(
        new THREE.BoxGeometry(ww, 0.01, wh),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      clickPad.position.set(wx, 0.05, wz);
      this.threeScene.add(clickPad);
      this.clickables.push({ mesh: clickPad, type: 'zone', id: key });
    });
  }

  private addZoneLabel(text: string, x: number, z: number, color: number) {
    // Create a canvas texture for the zone label
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 48;
    const ctx = canvas.getContext('2d')!;
    ctx.font = '20px "Space Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
    ctx.globalAlpha = 0.7;
    ctx.fillText(text, 128, 24);

    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.8 });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(x, 0.4, z);
    sprite.scale.set(3, 0.6, 1);
    this.threeScene.add(sprite);
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

    this.sceneReady = true;
    console.log('[World3D] Scene ready — sceneReady = true');
  }

  private async loadZoneBuildings(bump: () => void) {
    for (const [zoneKey, cfg] of Object.entries(ZONE_BUILDINGS)) {
      const zone = ZONES[zoneKey];
      if (!zone) { bump(); continue; }

      const colormap = await this.getColormap(cfg.dir);
      const cx = zone.x * SCALE - WORLD_CX;
      const cz = zone.y * SCALE - WORLD_CZ;
      const hw = (zone.w * SCALE) / 2;
      const hh = (zone.h * SCALE) / 2;
      const zoneColor = ZONE_COLORS[zoneKey] ?? 0x888888;

      for (let i = 0; i < cfg.count && i < cfg.files.length; i++) {
        const path = '/kenney/models/' + cfg.dir + '/' + cfg.files[i] + '.glb';
        const angle = (i / cfg.count) * Math.PI * 2;
        const radius = Math.min(hw, hh) * 0.55;
        const px = cx + Math.cos(angle) * radius;
        const pz = cz + Math.sin(angle) * radius;

        try {
          const gltf = await this.loader.loadAsync(path);
          const model = gltf.scene;
          console.log('[World3D] Loaded building:', path, 'children:', model.children.length);
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

          model.position.set(px, GROUND_Y, pz);
          model.rotation.y = -angle + Math.PI;
          model.scale.setScalar(1.2);
          this.threeScene.add(model);
        } catch (err) {
          console.warn('[World3D] Failed to load:', path, err);
          // GLB not found — place a fallback coloured box
          this.placeFallbackBuilding(px, pz, zoneColor, 0.6 + Math.random() * 0.8);
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

  // Road tiles are now placed by CityPopulator.buildStreetGrid()
  // Vehicles are now spawned by AmbientLife

  // ── Agent spawning ────────────────────────────────────────────────────────

  async spawnAgent(agentId: string): Promise<void> {
    if (this.agents.has(agentId)) return;

    const cfg = AGENT_MODELS[agentId];
    if (!cfg) return;

    const def = AGENT_DEFS[agentId];
    const zone = def?.zone ? ZONES[def.zone] : null;
    const spawnX = zone ? (zone.x * SCALE - WORLD_CX) + (Math.random() - 0.5) * (zone.w * SCALE * 0.4) : 0;
    const spawnZ = zone ? (zone.y * SCALE - WORLD_CZ) + (Math.random() - 0.5) * (zone.h * SCALE * 0.4) : 0;

    let model: THREE.Object3D;
    let mixer: THREE.AnimationMixer | null = null;
    let animations: THREE.AnimationClip[] = [];

    try {
      // Try loading character GLB
      const charLetter = cfg.model.replace('character-', '');
      let tex: THREE.Texture | null = null;

      try {
        tex = await this.texLoader.loadAsync('/kenney/textures/texture-' + charLetter + '.png');
        tex.flipY = false;
      } catch { /* no character texture — use colour tint only */ }

      const gltf = await this.loader.loadAsync('/kenney/models/characters/' + cfg.model + '.glb');
      model = gltf.scene;
      console.log('[World3D] Loaded agent:', agentId, 'model:', cfg.model);

      model.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          const mat = child.material as THREE.MeshStandardMaterial;
          if (tex) mat.map = tex;
          mat.emissive = new THREE.Color(cfg.color).multiplyScalar(0.15);
          mat.needsUpdate = true;
        }
      });

      model.scale.setScalar(0.8);
      animations = gltf.animations;

      if (animations.length > 0) {
        mixer = new THREE.AnimationMixer(model);
        this.mixers.push(mixer);
      }
    } catch {
      // GLB not found — create a procedural character (coloured capsule)
      model = this.createFallbackAgent(cfg.color);
    }

    model.position.set(spawnX, GROUND_Y, spawnZ);
    this.threeScene.add(model);

    // Add name label above agent
    this.addAgentLabel(def?.label ?? agentId, model, cfg.color);

    const agent = new AgentObject3D(agentId, model, mixer, cfg.color, cfg.cssColor, animations);
    agent.state.currentZone = def?.zone ?? '';
    this.agents.set(agentId, agent);
    this.clickables.push({ mesh: model, type: 'agent', id: agentId });
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
      const zone = ZONES[zoneKey];
      if (zone) {
        const tx = (zone.x * SCALE - WORLD_CX) + (Math.random() - 0.5) * (zone.w * SCALE * 0.5);
        const tz = (zone.y * SCALE - WORLD_CZ) + (Math.random() - 0.5) * (zone.h * SCALE * 0.5);
        agent.walkTo(tx, tz, this.mixers);
        agent.state.currentZone = zoneKey;
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
    this.camera.position.copy(this.camTarget).add(this.camOffset);
    this.camera.lookAt(this.camTarget);
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
      this.camTarget.x -= dx * this.panSpeed;
      this.camTarget.z += dy * this.panSpeed;
      this.lastMouse = { x: e.clientX, y: e.clientY };
      this.updateCamera();
    });

    // Scroll to zoom
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
      this.camTarget.x -= dx * this.panSpeed;
      this.camTarget.z += dy * this.panSpeed;
      this.lastMouse = { x: t.clientX, y: t.clientY };
      this.updateCamera();
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
    if (!zone) return;

    const color = '#' + (ZONE_COLORS[zoneKey] ?? 0x888888).toString(16).padStart(6, '0');
    this.hud?.showZonePanel(zoneKey, zone.icon + ' ' + zone.label, color);

    // Focus camera on zone
    this.camTarget.set(zone.x * SCALE - WORLD_CX, 0, zone.y * SCALE - WORLD_CZ);
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
    const delta = this.clock.getDelta();

    // WASD camera pan
    const speed = 0.15;
    let moved = false;
    if (this.keys.has('w') || this.keys.has('ArrowUp'))    { this.camTarget.z -= speed; moved = true; }
    if (this.keys.has('s') || this.keys.has('ArrowDown'))  { this.camTarget.z += speed; moved = true; }
    if (this.keys.has('a') || this.keys.has('ArrowLeft'))  { this.camTarget.x -= speed; moved = true; }
    if (this.keys.has('d') || this.keys.has('ArrowRight')) { this.camTarget.x += speed; moved = true; }
    if (moved) this.updateCamera();

    // Update animation mixers
    for (const m of this.mixers) m.update(delta);

    // Agent idle animations (subtle bob + sway when not walking)
    const time = performance.now() * 0.001;
    for (const [, agent] of this.agents) {
      if (!agent.state.isWalking) {
        // Gentle breathing bob — very subtle, pinned near ground
        agent.model.position.y = Math.abs(Math.sin(time * 1.5 + agent.color * 0.01)) * 0.02;
        // Subtle body sway
        agent.model.rotation.z = Math.sin(time * 0.8 + agent.color * 0.02) * 0.015;
        agent.model.rotation.x = 0; // no forward lean when idle
      } else {
        // Walking: bounce + lean
        agent.model.position.y = Math.abs(Math.sin(time * 6)) * 0.04;
        agent.model.rotation.z = Math.sin(time * 6) * 0.04;
        agent.model.rotation.x = 0.03; // slight forward lean
      }
      agent.updateBubble(this.camera);
    }

    // Update ambient life (NPCs, traffic, smoke)
    this.ambientLife.tick(delta);

    // Animate atmosphere particles
    if (this.atmospherePoints && this.atmosphereVelocities) {
      const aPos = this.atmospherePoints.geometry.attributes.position.array as Float32Array;
      const aVel = this.atmosphereVelocities;
      const count = aPos.length / 3;
      for (let i = 0; i < count; i++) {
        aPos[i * 3]     += aVel[i * 3];
        aPos[i * 3 + 1] += aVel[i * 3 + 1];
        aPos[i * 3 + 2] += aVel[i * 3 + 2];
        // Wrap around within world bounds
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
    const zone = ZONES[zoneKey];
    if (!zone) return;
    this.camTarget.set(zone.x * SCALE - WORLD_CX, 0, zone.y * SCALE - WORLD_CZ);
    this.updateCamera();
  }
}
