import * as THREE from 'three';

interface Collidable {
  box: THREE.Box3;
  type: 'building' | 'agent' | 'vehicle';
  id: string;
}

export class CollisionWorld {
  private statics: Collidable[] = [];   // buildings — never move
  private dynamics: Map<string, Collidable> = new Map(); // agents, vehicles

  /** Register a static building bounding box */
  addBuilding(id: string, object: THREE.Object3D) {
    const box = new THREE.Box3().setFromObject(object);
    // Shrink box slightly (models have decorative overhangs)
    box.expandByScalar(-0.1);
    this.statics.push({ box, type: 'building', id });
  }

  /** Update a dynamic object's position (agent or vehicle) */
  updateDynamic(id: string, position: THREE.Vector3, radius: number) {
    const half = radius;
    const box = new THREE.Box3(
      new THREE.Vector3(position.x - half, position.y, position.z - half),
      new THREE.Vector3(position.x + half, position.y + 1.8, position.z + half),
    );
    this.dynamics.set(id, { box, type: 'agent', id });
  }

  removeDynamic(id: string) { this.dynamics.delete(id); }

  /**
   * Given a proposed move from `from` to `to`, return the furthest
   * position reachable without entering any static building.
   * Uses simple binary search along the movement vector.
   */
  resolveMove(from: THREE.Vector3, to: THREE.Vector3, radius: number): THREE.Vector3 {
    // If destination is clear, accept it
    if (!this.collidesWithStatics(to, radius)) return to.clone();

    // Binary search for the furthest safe point
    let low = 0, high = 1;
    for (let i = 0; i < 8; i++) {
      const mid = (low + high) / 2;
      const candidate = from.clone().lerp(to, mid);
      if (this.collidesWithStatics(candidate, radius)) high = mid;
      else low = mid;
    }
    return from.clone().lerp(to, low * 0.95);
  }

  /**
   * Check if a circular footprint at `pos` with `radius` overlaps any building.
   */
  private collidesWithStatics(pos: THREE.Vector3, radius: number): boolean {
    const testBox = new THREE.Box3(
      new THREE.Vector3(pos.x - radius, -0.1, pos.z - radius),
      new THREE.Vector3(pos.x + radius,  2.0, pos.z + radius),
    );
    return this.statics.some(s => s.box.intersectsBox(testBox));
  }

  /**
   * Find a clear spawn point near `preferred` with given radius.
   * Tries random offsets until a clear spot is found (max 20 attempts).
   */
  findClearSpawn(preferred: THREE.Vector3, radius: number): THREE.Vector3 {
    if (!this.collidesWithStatics(preferred, radius)) return preferred.clone();
    for (let i = 0; i < 20; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist  = radius + Math.random() * 2;
      const candidate = preferred.clone().add(
        new THREE.Vector3(Math.cos(angle) * dist, 0, Math.sin(angle) * dist)
      );
      if (!this.collidesWithStatics(candidate, radius)) return candidate;
    }
    return preferred.clone(); // fallback — accept overlap
  }

  /**
   * Find a road point clear of all buildings (for vehicle paths).
   */
  isRoadClear(pos: THREE.Vector3): boolean {
    return !this.collidesWithStatics(pos, 0.8);
  }
}
