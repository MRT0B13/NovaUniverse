/**
 * DevMode — Sims-style build mode controller.
 * Toggle with B. Select, move, rotate, delete, place objects. Edit zones.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { WorldState, generateId } from './WorldState';
import type { PlacedObject, ZoneState } from './WorldState';
import { UndoStack } from './UndoStack';
import type { Command } from './UndoStack';
import { DevPalette } from './DevPalette';
import { DevProperties } from './DevProperties';
import { DevZoneEditor } from './DevZoneEditor';

// ── Context passed from World3D ──────────────────────────────────────────────

export interface DevModeContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  loader: GLTFLoader;
  texLoader: THREE.TextureLoader;
}

// ── Tool modes ───────────────────────────────────────────────────────────────

type Tool = 'select' | 'move' | 'rotate' | 'place';

// ── Tracked scene object ─────────────────────────────────────────────────────

interface SceneObject {
  id: string;
  model: THREE.Object3D;
  data: PlacedObject;
}

// ════════════════════════════════════════════════════════════════════════════════

export class DevMode {
  active = false;

  private ctx: DevModeContext;
  private state: WorldState;
  private undo: UndoStack;
  private palette: DevPalette;
  private properties: DevProperties;
  private zoneEditor: DevZoneEditor;
  private toolbar: HTMLDivElement;

  // Scene tracking
  private objects = new Map<string, SceneObject>();
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  // Selection
  private selectedId: string | null = null;
  private selectedZone: string | null = null;
  private highlightMat: THREE.MeshStandardMaterial;
  private originalMats = new Map<string, Map<THREE.Mesh, THREE.Material>>();

  // Current tool
  private tool: Tool = 'select';

  // Placement ghost
  private ghostModel: THREE.Object3D | null = null;
  private ghostAsset: string | null = null;
  private ghostCategory: string | null = null;

  // Move/rotate state
  private isTransforming = false;
  private transformStart = new THREE.Vector3();

  // Grid overlay
  private gridHelper: THREE.GridHelper | null = null;

  // Model cache
  private modelCache = new Map<string, THREE.Object3D>();
  private colormapCache = new Map<string, THREE.Texture>();

  constructor(ctx: DevModeContext) {
    this.ctx = ctx;
    this.state = new WorldState();
    this.undo = new UndoStack();

    this.highlightMat = new THREE.MeshStandardMaterial({
      color: 0x00ff88, emissive: new THREE.Color(0x00ff88), emissiveIntensity: 0.4,
      transparent: true, opacity: 0.85,
    });

    // Create UI
    const hud = document.getElementById('hud') ?? document.body;

    this.toolbar = this.createToolbar();
    hud.appendChild(this.toolbar);

    this.palette = new DevPalette(hud, (cat, asset) => this.startPlacement(cat, asset));

    this.properties = new DevProperties(
      hud,
      (id, updates) => this.updateObject(id, updates),
      (key, updates) => this.updateZone(key, updates),
      (id) => this.deleteObject(id),
      (id) => this.duplicateObject(id),
    );

    this.zoneEditor = new DevZoneEditor(ctx.scene, (key, updates) => this.updateZone(key, updates));

    // Hide until activated
    this.toolbar.style.display = 'none';
    this.palette.hide();
    this.properties.hide();

    // Bind input
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    window.addEventListener('keydown', this.onKeyDown);
  }

  // ── Toggle ──────────────────────────────────────────────────────────────

  toggle(): void {
    this.active = !this.active;
    if (this.active) this.enter(); else this.exit();
  }

  private enter(): void {
    this.toolbar.style.display = 'flex';
    this.palette.show();
    this.properties.show();

    // Show grid
    this.gridHelper = new THREE.GridHelper(60, 120, 0x222244, 0x111133);
    this.gridHelper.position.y = 0.02;
    this.ctx.scene.add(this.gridHelper);

    // Bind canvas events — use pointer events for unified mouse+touch
    const canvas = this.ctx.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);

    this.setTool('select');
  }

  private exit(): void {
    this.toolbar.style.display = 'none';
    this.palette.hide();
    this.properties.hide();
    this.zoneEditor.hideHandles();

    // Remove grid
    if (this.gridHelper) {
      this.ctx.scene.remove(this.gridHelper);
      this.gridHelper.geometry.dispose();
      this.gridHelper = null;
    }

    // Remove ghost
    this.clearGhost();
    this.deselectAll();

    const canvas = this.ctx.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
  }

  // ── Tool switching ──────────────────────────────────────────────────────

  private setTool(tool: Tool): void {
    this.tool = tool;
    if (tool !== 'place') this.clearGhost();
    this.updateToolbarHighlight();
  }

  // ── Selection ───────────────────────────────────────────────────────────

  private select(id: string): void {
    this.deselectAll();
    this.selectedId = id;
    this.selectedZone = null;

    const obj = this.objects.get(id);
    if (!obj) return;

    // Highlight
    const matMap = new Map<THREE.Mesh, THREE.Material>();
    obj.model.traverse(c => {
      if (c instanceof THREE.Mesh) {
        matMap.set(c, c.material as THREE.Material);
        c.material = this.highlightMat;
      }
    });
    this.originalMats.set(id, matMap);

    this.properties.showObject(obj.data);
  }

  private selectZone(key: string): void {
    this.deselectAll();
    this.selectedZone = key;
    this.selectedId = null;

    const zone = this.state.layout.zones[key];
    if (!zone) return;

    this.zoneEditor.showForZone(key, zone);
    this.properties.showZone(key, zone);
  }

  private deselectAll(): void {
    // Restore materials
    if (this.selectedId) {
      const matMap = this.originalMats.get(this.selectedId);
      const obj = this.objects.get(this.selectedId);
      if (matMap && obj) {
        obj.model.traverse(c => {
          if (c instanceof THREE.Mesh && matMap.has(c)) {
            c.material = matMap.get(c)!;
          }
        });
      }
      this.originalMats.delete(this.selectedId);
    }
    this.selectedId = null;
    this.selectedZone = null;
    this.zoneEditor.hideHandles();
    this.properties.clearSelection();
  }

  // Pointer drag state (for click vs drag detection + object dragging)
  private pointerDown = false;
  private pointerDownPos = { x: 0, y: 0 };
  private pointerMoved = false;
  private isDraggingObject = false;
  private dragObjectId: string | null = null;

  // ── Raycasting ──────────────────────────────────────────────────────────

  private getWorldPosFromClient(clientX: number, clientY: number): THREE.Vector3 | null {
    const rect = this.ctx.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      ((clientY - rect.top) / rect.height) * -2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.ctx.camera);
    const target = new THREE.Vector3();
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, target);
    return hit ? target : null;
  }

  private snap(v: number): number { return Math.round(v * 2) / 2; }

  private hitTestFromClient(clientX: number, clientY: number): { type: 'object'; id: string } | { type: 'zone'; key: string } | { type: 'handle'; handle: any } | null {
    const rect = this.ctx.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      ((clientY - rect.top) / rect.height) * -2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.ctx.camera);

    // Check zone handles first
    const handleMeshes = this.zoneEditor.getMeshes();
    if (handleMeshes.length > 0) {
      const handleHits = this.raycaster.intersectObjects(handleMeshes);
      if (handleHits.length > 0) {
        const handle = this.zoneEditor.getHandle(handleHits[0].object);
        if (handle) return { type: 'handle', handle };
      }
    }

    // Check placed objects
    const allMeshes: THREE.Object3D[] = [];
    const meshToId = new Map<THREE.Object3D, string>();
    for (const [id, obj] of this.objects) {
      obj.model.traverse(c => {
        if (c instanceof THREE.Mesh) {
          allMeshes.push(c);
          meshToId.set(c, id);
        }
      });
    }

    const hits = this.raycaster.intersectObjects(allMeshes);
    if (hits.length > 0) {
      const id = meshToId.get(hits[0].object);
      if (id) return { type: 'object', id };
    }

    return null;
  }

  // ── Pointer handlers (unified mouse + touch) ──────────────────────────

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.active) return;
    // Ignore non-primary buttons (right-click used for orbit in World3D)
    if (e.button !== 0) return;

    this.pointerDown = true;
    this.pointerDownPos = { x: e.clientX, y: e.clientY };
    this.pointerMoved = false;

    // In select mode, check if we're clicking on an object → prepare for drag
    if (this.tool === 'select') {
      const hit = this.hitTestFromClient(e.clientX, e.clientY);
      if (hit && hit.type === 'object') {
        this.dragObjectId = hit.id;
      }
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.active) return;
    const pos = this.getWorldPosFromClient(e.clientX, e.clientY);
    if (!pos) return;

    // Check if pointer has moved enough to count as drag (5px threshold)
    if (this.pointerDown) {
      const dx = e.clientX - this.pointerDownPos.x;
      const dy = e.clientY - this.pointerDownPos.y;
      if (Math.sqrt(dx * dx + dy * dy) > 5) {
        this.pointerMoved = true;

        // Auto-start move if dragging a selected or hovered object
        if (this.tool === 'select' && this.dragObjectId && !this.isDraggingObject) {
          this.select(this.dragObjectId);
          this.selectedId = this.dragObjectId;
          this.isDraggingObject = true;
          this.isTransforming = true;
          this.tool = 'move';
          this.updateToolbarHighlight();
        }
      }
    }

    // Ghost preview follows cursor
    if (this.tool === 'place' && this.ghostModel) {
      this.ghostModel.position.set(this.snap(pos.x), 0, this.snap(pos.z));
    }

    // Move tool — drag selected object
    if (this.tool === 'move' && this.isTransforming && this.selectedId) {
      const obj = this.objects.get(this.selectedId);
      if (obj) {
        const x = this.snap(pos.x);
        const z = this.snap(pos.z);
        obj.model.position.set(x, 0, z);
        obj.data.x = x;
        obj.data.z = z;
        this.state.updateObject(this.selectedId, { x, z });
        this.properties.showObject(obj.data);
      }
    }

    // Rotate tool — horizontal mouse movement = Y rotation
    if (this.tool === 'rotate' && this.isTransforming && this.selectedId) {
      const obj = this.objects.get(this.selectedId);
      if (obj) {
        const dx = pos.x - this.transformStart.x;
        const rotY = Math.round((dx * 2) / (Math.PI / 4)) * (Math.PI / 4); // snap 45°
        obj.model.rotation.y = rotY;
        obj.data.rotY = rotY;
        this.state.updateObject(this.selectedId, { rotY });
      }
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.active) return;
    if (e.button !== 0) return;

    const wasDragging = this.isDraggingObject;
    const wasMoved = this.pointerMoved;

    // End drag-move
    if (this.isDraggingObject) {
      this.isDraggingObject = false;
      this.isTransforming = false;
      this.dragObjectId = null;
      this.setTool('select');
      this.pointerDown = false;
      return;
    }

    this.dragObjectId = null;
    this.pointerDown = false;

    // If pointer didn't move much, treat as a click
    if (!wasMoved) {
      this.handlePointerClick(e.clientX, e.clientY);
    }
  };

  private handlePointerClick(clientX: number, clientY: number): void {
    // Placement mode
    if (this.tool === 'place' && this.ghostModel && this.ghostAsset && this.ghostCategory) {
      const pos = this.getWorldPosFromClient(clientX, clientY);
      if (!pos) return;
      this.placeObject(this.ghostCategory + '/' + this.ghostAsset, this.snap(pos.x), this.snap(pos.z));
      return;
    }

    // Move mode — confirm placement
    if (this.tool === 'move' && this.isTransforming && this.selectedId) {
      this.isTransforming = false;
      this.setTool('select');
      return;
    }

    // Rotate mode — confirm
    if (this.tool === 'rotate' && this.isTransforming && this.selectedId) {
      this.isTransforming = false;
      this.setTool('select');
      return;
    }

    // Select mode
    const hit = this.hitTestFromClient(clientX, clientY);
    if (!hit) { this.deselectAll(); return; }

    if (hit.type === 'object') {
      this.select(hit.id);
    } else if (hit.type === 'zone') {
      this.selectZone(hit.key);
    }
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    // B toggles build mode (always active)
    if (e.key === 'b' || e.key === 'B') {
      if (e.target instanceof HTMLInputElement) return;
      this.toggle();
      return;
    }

    if (!this.active) return;

    // Escape — cancel current action
    if (e.key === 'Escape') {
      if (this.tool === 'place') { this.clearGhost(); this.setTool('select'); this.palette.clearSelection(); }
      else if (this.isTransforming) { this.isTransforming = false; this.setTool('select'); }
      else { this.deselectAll(); }
      return;
    }

    // G — move tool
    if (e.key === 'g' || e.key === 'G') {
      if (this.selectedId) { this.startMove(); }
      return;
    }

    // R — rotate tool
    if (e.key === 'r' || e.key === 'R') {
      if (this.selectedId) { this.startRotate(); }
      return;
    }

    // Delete
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.selectedId) { this.deleteObject(this.selectedId); }
      return;
    }

    // Ctrl+Z — undo
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
      e.preventDefault();
      this.undo.undo();
      return;
    }

    // Ctrl+Shift+Z — redo
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Z') {
      e.preventDefault();
      this.undo.redo();
      return;
    }

    // Ctrl+S — export
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      this.state.exportJSON();
      return;
    }

    // Ctrl+D — duplicate
    if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
      e.preventDefault();
      if (this.selectedId) this.duplicateObject(this.selectedId);
      return;
    }
  };

  // ── Object operations ───────────────────────────────────────────────────

  private async placeObject(asset: string, x: number, z: number): Promise<void> {
    const id = generateId();
    const data: PlacedObject = { id, asset, x, z, rotY: 0, scale: 0.7 };

    const model = await this.loadAsset(asset);
    if (!model) return;

    model.position.set(x, 0, z);
    model.scale.setScalar(data.scale);
    this.ctx.scene.add(model);

    this.objects.set(id, { id, model, data });
    this.state.addObject(data);

    // Undo command
    this.undo.exec({
      label: 'Place ' + asset.split('/').pop(),
      execute: () => {}, // already done
      undo: () => this.removeFromScene(id),
    });

    this.select(id);
  }

  private deleteObject(id: string): void {
    const obj = this.objects.get(id);
    if (!obj) return;

    const data = { ...obj.data };
    this.removeFromScene(id);
    this.state.removeObject(id);
    this.deselectAll();

    this.undo.exec({
      label: 'Delete ' + data.asset.split('/').pop(),
      execute: () => {},
      undo: () => {
        // Re-add on undo
        this.restoreObject(data);
      },
    });
  }

  private async duplicateObject(id: string): Promise<void> {
    const obj = this.objects.get(id);
    if (!obj) return;

    const newX = obj.data.x + 1;
    const newZ = obj.data.z + 1;
    await this.placeObject(obj.data.asset, newX, newZ);
  }

  private updateObject(id: string, updates: Partial<PlacedObject>): void {
    const obj = this.objects.get(id);
    if (!obj) return;

    if (updates.x !== undefined) obj.model.position.x = updates.x;
    if (updates.z !== undefined) obj.model.position.z = updates.z;
    if (updates.rotY !== undefined) obj.model.rotation.y = updates.rotY;
    if (updates.scale !== undefined) obj.model.scale.setScalar(updates.scale);

    Object.assign(obj.data, updates);
    this.state.updateObject(id, updates);
  }

  private removeFromScene(id: string): void {
    const obj = this.objects.get(id);
    if (!obj) return;
    this.ctx.scene.remove(obj.model);
    this.objects.delete(id);
    this.originalMats.delete(id);
  }

  private async restoreObject(data: PlacedObject): Promise<void> {
    const model = await this.loadAsset(data.asset);
    if (!model) return;
    model.position.set(data.x, 0, data.z);
    model.rotation.y = data.rotY;
    model.scale.setScalar(data.scale);
    this.ctx.scene.add(model);
    this.objects.set(data.id, { id: data.id, model, data: { ...data } });
    this.state.addObject(data);
  }

  // ── Zone operations ─────────────────────────────────────────────────────

  private updateZone(key: string, updates: Partial<ZoneState>): void {
    this.state.updateZone(key, updates);
    const zone = this.state.layout.zones[key];
    if (zone) {
      this.zoneEditor.updatePositions(zone);
      this.properties.showZone(key, zone);
    }
  }

  // ── Transform tools ─────────────────────────────────────────────────────

  private startMove(): void {
    if (!this.selectedId) return;
    this.tool = 'move';
    this.isTransforming = true;
    const obj = this.objects.get(this.selectedId);
    if (obj) this.transformStart.copy(obj.model.position);
    this.updateToolbarHighlight();
  }

  private startRotate(): void {
    if (!this.selectedId) return;
    this.tool = 'rotate';
    this.isTransforming = true;
    const obj = this.objects.get(this.selectedId);
    if (obj) this.transformStart.copy(obj.model.position);
    this.updateToolbarHighlight();
  }

  // ── Placement ───────────────────────────────────────────────────────────

  private async startPlacement(category: string, asset: string): Promise<void> {
    this.clearGhost();
    this.setTool('place');
    this.ghostCategory = category;
    this.ghostAsset = asset;

    const model = await this.loadAsset(category + '/' + asset);
    if (!model) return;

    model.scale.setScalar(0.7);
    // Make translucent
    model.traverse(c => {
      if (c instanceof THREE.Mesh) {
        const mat = (c.material as THREE.MeshStandardMaterial).clone();
        mat.transparent = true;
        mat.opacity = 0.5;
        c.material = mat;
      }
    });

    this.ghostModel = model;
    this.ctx.scene.add(model);
  }

  private clearGhost(): void {
    if (this.ghostModel) {
      this.ctx.scene.remove(this.ghostModel);
      this.ghostModel = null;
    }
    this.ghostAsset = null;
    this.ghostCategory = null;
  }

  // ── Asset loading ───────────────────────────────────────────────────────

  private async loadAsset(asset: string): Promise<THREE.Object3D | null> {
    if (this.modelCache.has(asset)) {
      return this.modelCache.get(asset)!.clone();
    }

    // Determine path: custom/ assets live in custom/, others in their category dir
    const path = '/kenney/models/' + asset + '.glb';
    try {
      const gltf = await this.ctx.loader.loadAsync(path);
      const model = gltf.scene;

      // Try to apply colormap
      const category = asset.split('/')[0];
      const colormap = await this.getColormap(category);
      model.traverse(c => {
        if (c instanceof THREE.Mesh) {
          c.castShadow = true;
          c.receiveShadow = true;
          if (colormap) {
            const mat = c.material as THREE.MeshStandardMaterial;
            if (!mat.map) { mat.map = colormap; mat.needsUpdate = true; }
          }
        }
      });

      this.modelCache.set(asset, model);
      return model.clone();
    } catch {
      console.warn('[DevMode] Failed to load:', path);
      return null;
    }
  }

  private async getColormap(category: string): Promise<THREE.Texture | null> {
    if (this.colormapCache.has(category)) return this.colormapCache.get(category)!;
    try {
      const tex = await this.ctx.texLoader.loadAsync('/kenney/textures/' + category + '_colormap.png');
      tex.flipY = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      this.colormapCache.set(category, tex);
      return tex;
    } catch { return null; }
  }

  // ── Load saved state ────────────────────────────────────────────────────

  /** Call on startup to load saved world layout */
  async loadSavedState(): Promise<boolean> {
    if (!this.state.load()) return false;

    // Restore objects
    for (const data of this.state.layout.objects) {
      const model = await this.loadAsset(data.asset);
      if (!model) continue;
      model.position.set(data.x, 0, data.z);
      model.rotation.y = data.rotY;
      model.scale.setScalar(data.scale);
      this.ctx.scene.add(model);
      this.objects.set(data.id, { id: data.id, model, data });
    }

    return true;
  }

  /** Initialize zone state from current ZONE_3D config */
  initZoneState(zones: Record<string, { cx: number; cz: number; w: number; h: number }>, colors: Record<string, number>, labels: Record<string, string>, icons: Record<string, string>): void {
    // Only set if no saved state exists
    if (Object.keys(this.state.layout.zones).length > 0) return;
    for (const [key, z] of Object.entries(zones)) {
      this.state.setZone(key, {
        cx: z.cx, cz: z.cz, w: z.w, h: z.h,
        color: colors[key] ?? 0x888888,
        label: labels[key] ?? key,
        icon: icons[key] ?? '',
      });
    }
  }

  // ── Import ──────────────────────────────────────────────────────────────

  async importLayout(): Promise<void> {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const ok = await this.state.importJSON(file);
      if (ok) {
        // Clear scene objects and reload
        for (const [id] of this.objects) this.removeFromScene(id);
        await this.loadSavedState();
      }
    };
    input.click();
  }

  // ── Toolbar ─────────────────────────────────────────────────────────────

  private toolbarBtns = new Map<string, HTMLButtonElement>();

  private createToolbar(): HTMLDivElement {
    const bar = document.createElement('div');
    bar.id = 'dev-toolbar';
    bar.style.cssText = `
      position:fixed; top:0; left:0; right:0; height:40px;
      background:rgba(0,0,0,0.95); border-bottom:2px solid #00ff88;
      display:flex; align-items:center; padding:0 12px; gap:6px;
      font-family:'Space Mono',monospace; z-index:1002;
      pointer-events:auto; touch-action:auto;
    `;
    // Stop all pointer events from propagating to the canvas behind
    for (const evt of ['pointerdown', 'pointermove', 'pointerup', 'click', 'mousedown', 'mouseup', 'touchstart', 'touchmove', 'touchend'] as const) {
      bar.addEventListener(evt, e => e.stopPropagation());
    }

    // Build mode label
    const label = document.createElement('span');
    label.textContent = 'BUILD MODE';
    label.style.cssText = 'color:#00ff88; font-weight:bold; font-size:13px; margin-right:16px; letter-spacing:2px;';
    bar.appendChild(label);

    // Tool buttons
    const tools: [string, string, () => void][] = [
      ['select', 'Select', () => this.setTool('select')],
      ['move', 'Move (G)', () => { if (this.selectedId) this.startMove(); }],
      ['rotate', 'Rotate (R)', () => { if (this.selectedId) this.startRotate(); }],
      ['delete', 'Delete', () => { if (this.selectedId) this.deleteObject(this.selectedId); }],
    ];

    for (const [id, text, fn] of tools) {
      const btn = this.createToolBtn(text, fn);
      this.toolbarBtns.set(id, btn);
      bar.appendChild(btn);
    }

    // Separator
    bar.appendChild(this.createSep());

    // Undo/Redo
    bar.appendChild(this.createToolBtn('Undo', () => this.undo.undo()));
    bar.appendChild(this.createToolBtn('Redo', () => this.undo.redo()));

    // Separator
    bar.appendChild(this.createSep());

    // Save/Export/Import
    bar.appendChild(this.createToolBtn('Save', () => this.state.save()));
    bar.appendChild(this.createToolBtn('Export', () => this.state.exportJSON()));
    bar.appendChild(this.createToolBtn('Import', () => this.importLayout()));

    // Separator + exit
    bar.appendChild(this.createSep());
    const exitBtn = this.createToolBtn('Exit (B)', () => this.toggle());
    exitBtn.style.color = '#ff4444';
    exitBtn.style.borderColor = '#ff4444';
    bar.appendChild(exitBtn);

    return bar;
  }

  private createToolBtn(text: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.style.cssText = `
      padding:4px 10px; background:#111; border:1px solid #333; border-radius:4px;
      color:#aaa; cursor:pointer; font-family:inherit; font-size:10px;
      transition: border-color 0.15s, color 0.15s;
    `;
    btn.onmouseenter = () => { btn.style.borderColor = '#00ff88'; btn.style.color = '#fff'; };
    btn.onmouseleave = () => {
      if (!btn.classList.contains('active')) { btn.style.borderColor = '#333'; btn.style.color = '#aaa'; }
    };
    btn.onclick = onClick;
    return btn;
  }

  private createSep(): HTMLDivElement {
    const sep = document.createElement('div');
    sep.style.cssText = 'width:1px; height:20px; background:#333; margin:0 6px;';
    return sep;
  }

  private updateToolbarHighlight(): void {
    for (const [id, btn] of this.toolbarBtns) {
      if (id === this.tool) {
        btn.style.borderColor = '#00ff88';
        btn.style.color = '#00ff88';
        btn.classList.add('active');
      } else {
        btn.style.borderColor = '#333';
        btn.style.color = '#aaa';
        btn.classList.remove('active');
      }
    }
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.exit();
    this.palette.dispose();
    this.properties.dispose();
    this.zoneEditor.dispose();
    this.toolbar.remove();
    this.highlightMat.dispose();
  }
}
