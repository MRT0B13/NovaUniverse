/**
 * DevZoneEditor — zone resize handles, move, visual feedback.
 * Shows draggable corner + edge handles when a zone is selected.
 */

import * as THREE from 'three';
import type { ZoneState } from './WorldState';

export type OnZoneResized = (key: string, updates: Partial<ZoneState>) => void;

interface Handle {
  mesh: THREE.Mesh;
  type: 'corner' | 'edge' | 'center';
  // Which part: 'nw','ne','sw','se','n','s','e','w','center'
  position: string;
}

const HANDLE_COLOR = 0x00ff88;
const HANDLE_HOVER = 0xffffff;
const HANDLE_SIZE = 0.25;

export class DevZoneEditor {
  private scene: THREE.Scene;
  private handles: Handle[] = [];
  private activeZone: string | null = null;
  private onResized: OnZoneResized;
  private handleMat: THREE.MeshStandardMaterial;
  private hoverMat: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Scene, onResized: OnZoneResized) {
    this.scene = scene;
    this.onResized = onResized;
    this.handleMat = new THREE.MeshStandardMaterial({
      color: HANDLE_COLOR, emissive: new THREE.Color(HANDLE_COLOR), emissiveIntensity: 0.8,
    });
    this.hoverMat = new THREE.MeshStandardMaterial({
      color: HANDLE_HOVER, emissive: new THREE.Color(HANDLE_HOVER), emissiveIntensity: 1.0,
    });
  }

  /** Show handles around the given zone */
  showForZone(key: string, zone: ZoneState): void {
    this.hideHandles();
    this.activeZone = key;

    const { cx, cz, w, h } = zone;
    const hw = w / 2, hh = h / 2;
    const geo = new THREE.SphereGeometry(HANDLE_SIZE, 8, 8);

    // Corners
    const corners: [string, number, number][] = [
      ['nw', cx - hw, cz - hh], ['ne', cx + hw, cz - hh],
      ['sw', cx - hw, cz + hh], ['se', cx + hw, cz + hh],
    ];
    for (const [pos, x, z] of corners) {
      this.addHandle(geo, x, z, 'corner', pos);
    }

    // Edge midpoints
    const edges: [string, number, number][] = [
      ['n', cx, cz - hh], ['s', cx, cz + hh],
      ['w', cx - hw, cz], ['e', cx + hw, cz],
    ];
    for (const [pos, x, z] of edges) {
      this.addHandle(geo, x, z, 'edge', pos);
    }

    // Center handle (for moving)
    const centerGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.15, 12);
    this.addHandle(centerGeo, cx, cz, 'center', 'center');
  }

  hideHandles(): void {
    for (const h of this.handles) {
      this.scene.remove(h.mesh);
      h.mesh.geometry.dispose();
    }
    this.handles = [];
    this.activeZone = null;
  }

  /** Check if a mesh is one of our handles */
  getHandle(mesh: THREE.Object3D): Handle | null {
    return this.handles.find(h => h.mesh === mesh) ?? null;
  }

  /** Get all handle meshes for raycasting */
  getMeshes(): THREE.Object3D[] {
    return this.handles.map(h => h.mesh);
  }

  /** Apply a drag delta to a handle, returns zone updates */
  applyDrag(handle: Handle, worldPos: THREE.Vector3, zone: ZoneState): Partial<ZoneState> {
    const snap = (v: number) => Math.round(v * 2) / 2; // snap to 0.5
    const x = snap(worldPos.x);
    const z = snap(worldPos.z);

    if (handle.type === 'center') {
      return { cx: x, cz: z };
    }

    const { cx, cz, w, h } = zone;
    const hw = w / 2, hh = h / 2;
    let newCx = cx, newCz = cz, newW = w, newH = h;

    const pos = handle.position;
    // Horizontal edges
    if (pos.includes('w')) { const edge = cx + hw; newW = Math.max(2, edge - x); newCx = edge - newW / 2; }
    if (pos.includes('e')) { const edge = cx - hw; newW = Math.max(2, x - edge); newCx = edge + newW / 2; }
    // Vertical edges
    if (pos.includes('n')) { const edge = cz + hh; newH = Math.max(2, edge - z); newCz = edge - newH / 2; }
    if (pos.includes('s')) { const edge = cz - hh; newH = Math.max(2, z - edge); newCz = edge + newH / 2; }

    return { cx: snap(newCx), cz: snap(newCz), w: snap(newW), h: snap(newH) };
  }

  /** Update handle positions after zone change */
  updatePositions(zone: ZoneState): void {
    const { cx, cz, w, h } = zone;
    const hw = w / 2, hh = h / 2;
    const posMap: Record<string, [number, number]> = {
      nw: [cx - hw, cz - hh], ne: [cx + hw, cz - hh],
      sw: [cx - hw, cz + hh], se: [cx + hw, cz + hh],
      n: [cx, cz - hh], s: [cx, cz + hh],
      w: [cx - hw, cz], e: [cx + hw, cz],
      center: [cx, cz],
    };
    for (const h of this.handles) {
      const p = posMap[h.position];
      if (p) h.mesh.position.set(p[0], 0.3, p[1]);
    }
  }

  highlightHandle(handle: Handle | null): void {
    for (const h of this.handles) {
      (h.mesh.material as THREE.MeshStandardMaterial) = this.handleMat;
    }
    if (handle) {
      (handle.mesh.material as THREE.MeshStandardMaterial) = this.hoverMat;
    }
  }

  getActiveZone(): string | null { return this.activeZone; }

  dispose(): void {
    this.hideHandles();
    this.handleMat.dispose();
    this.hoverMat.dispose();
  }

  private addHandle(geo: THREE.BufferGeometry, x: number, z: number, type: Handle['type'], position: string) {
    const mesh = new THREE.Mesh(geo, this.handleMat.clone());
    mesh.position.set(x, 0.3, z);
    this.scene.add(mesh);
    this.handles.push({ mesh, type, position });
  }
}
