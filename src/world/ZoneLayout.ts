import * as THREE from 'three';

/**
 * ZoneLayout manages building placement within a zone.
 * It divides each zone into a grid and places buildings into cells,
 * leaving the centre clear for agents to walk through.
 * Buildings face inward toward the zone centre.
 */

export interface BuildingSlot {
  x: number;       // Three.js world X
  z: number;       // Three.js world Z
  rotation: number; // Y rotation in radians (faces zone centre)
  taken: boolean;
}

export class ZoneLayout {
  private slots: BuildingSlot[] = [];
  private cellSize = 1.8; // Three.js units per grid cell

  /**
   * @param cx Zone centre X in Three.js units
   * @param cz Zone centre Z in Three.js units
   * @param width Zone width in Three.js units
   * @param depth Zone depth in Three.js units
   * @param clearRadius Radius around centre to keep clear for agents
   */
  constructor(
    cx: number, cz: number,
    width: number, depth: number,
    clearRadius = 1.8
  ) {
    const cols = Math.floor(width  / this.cellSize);
    const rows = Math.floor(depth  / this.cellSize);
    const startX = cx - (cols * this.cellSize) / 2;
    const startZ = cz - (rows * this.cellSize) / 2;

    // Inset from zone edges so buildings don't overflow
    const inset = 0.3;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = startX + c * this.cellSize + this.cellSize / 2;
        const z = startZ + r * this.cellSize + this.cellSize / 2;

        // Skip if too close to zone edge (boundary inset)
        if (x < cx - width / 2 + inset || x > cx + width / 2 - inset) continue;
        if (z < cz - depth / 2 + inset || z > cz + depth / 2 - inset) continue;

        // Skip cells near the centre (agent walkway)
        const distFromCentre = Math.sqrt((x - cx) ** 2 + (z - cz) ** 2);
        if (distFromCentre < clearRadius) continue;

        // Face building toward zone centre
        const rotation = Math.atan2(cx - x, cz - z);

        this.slots.push({ x, z, rotation, taken: false });
      }
    }

    // Sort by distance from centre — perimeter first (closest to edge)
    this.slots.sort((a, b) => {
      const da = (a.x - cx) ** 2 + (a.z - cz) ** 2;
      const db = (b.x - cx) ** 2 + (b.z - cz) ** 2;
      return db - da; // furthest from centre first
    });
  }

  /** Get the next available slot, or null if zone is full */
  nextSlot(): BuildingSlot | null {
    const free = this.slots.filter(s => !s.taken);
    if (free.length === 0) return null;
    const slot = free[0];
    slot.taken = true;
    return slot;
  }

  /** Get all agent walk positions (clear area near centre) */
  getAgentSpawnPoints(cx: number, cz: number, count: number): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      points.push(new THREE.Vector3(
        cx + Math.cos(angle) * 1.2,
        0,
        cz + Math.sin(angle) * 1.2
      ));
    }
    return points;
  }
}
