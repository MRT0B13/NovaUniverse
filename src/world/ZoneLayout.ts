import * as THREE from 'three';

/**
 * ZoneLayout manages building placement within a zone.
 * It divides each zone into a grid and places buildings into cells,
 * leaving the centre clear for agents to walk through.
 */

export interface BuildingSlot {
  x: number;       // Three.js world X
  z: number;       // Three.js world Z
  rotation: number; // Y rotation in radians
  taken: boolean;
}

export class ZoneLayout {
  private slots: BuildingSlot[] = [];
  private cellSize = 2.5; // Three.js units per grid cell

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
    clearRadius = 2.5
  ) {
    const cols = Math.floor(width  / this.cellSize);
    const rows = Math.floor(depth  / this.cellSize);
    const startX = cx - (cols * this.cellSize) / 2;
    const startZ = cz - (rows * this.cellSize) / 2;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = startX + c * this.cellSize + this.cellSize / 2;
        const z = startZ + r * this.cellSize + this.cellSize / 2;

        // Skip cells near the centre (agent path)
        const distFromCentre = Math.sqrt((x - cx) ** 2 + (z - cz) ** 2);
        if (distFromCentre < clearRadius) continue;

        // Skip centre row/column entirely (walkway)
        const colFromCentre = Math.abs(c - cols / 2);
        const rowFromCentre = Math.abs(r - rows / 2);
        if (colFromCentre < 1 || rowFromCentre < 1) continue;

        this.slots.push({
          x, z,
          rotation: (Math.floor(Math.random() * 4) * Math.PI) / 2, // 0°, 90°, 180°, 270°
          taken: false,
        });
      }
    }
  }

  /** Get the next available slot, or null if zone is full */
  nextSlot(): BuildingSlot | null {
    const free = this.slots.filter(s => !s.taken);
    if (free.length === 0) return null;
    // Pick from perimeter slots first (leave interior for agents)
    const slot = free[0];
    slot.taken = true;
    return slot;
  }

  /** Get all agent walk positions (clear area) */
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
