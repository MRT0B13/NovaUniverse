/**
 * WorldState — serializable world layout model.
 * Handles save to localStorage, export/import JSON.
 */

export interface PlacedObject {
  id: string;
  asset: string;        // e.g. "commercial/building-skyscraper-a"
  x: number;
  z: number;
  rotY: number;
  scale: number;
  zoneKey?: string;
}

export interface ZoneState {
  cx: number;
  cz: number;
  w: number;
  h: number;
  color: number;
  label: string;
  icon: string;
}

export interface WorldLayout {
  version: number;
  zones: Record<string, ZoneState>;
  objects: PlacedObject[];
}

const STORAGE_KEY = 'nova-world-layout';
const CURRENT_VERSION = 1;

let idCounter = 0;
export function generateId(): string {
  return 'obj_' + Date.now().toString(36) + '_' + (idCounter++).toString(36);
}

export class WorldState {
  layout: WorldLayout;

  constructor() {
    this.layout = { version: CURRENT_VERSION, zones: {}, objects: [] };
  }

  // ── Persistence ─────────────────────────────────────────────────────────

  /** Save current layout to localStorage */
  save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.layout));
    } catch (e) {
      console.warn('[WorldState] Failed to save:', e);
    }
  }

  /** Load from localStorage. Returns true if a saved layout existed. */
  load(): boolean {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw) as WorldLayout;
      if (!parsed.version || !parsed.objects) return false;
      this.layout = parsed;
      return true;
    } catch {
      return false;
    }
  }

  /** Clear saved layout */
  clear(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.layout = { version: CURRENT_VERSION, zones: {}, objects: [] };
  }

  // ── Export / Import ──────────────────────────────────────────────────────

  /** Download layout as JSON file */
  exportJSON(): void {
    const json = JSON.stringify(this.layout, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'world-layout.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Import from JSON file. Returns true on success. */
  importJSON(file: File): Promise<boolean> {
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result as string) as WorldLayout;
          if (!parsed.version || !Array.isArray(parsed.objects)) {
            resolve(false);
            return;
          }
          this.layout = parsed;
          this.save();
          resolve(true);
        } catch {
          resolve(false);
        }
      };
      reader.onerror = () => resolve(false);
      reader.readAsText(file);
    });
  }

  // ── Object operations ────────────────────────────────────────────────────

  addObject(obj: PlacedObject): void {
    this.layout.objects.push(obj);
    this.save();
  }

  removeObject(id: string): PlacedObject | null {
    const idx = this.layout.objects.findIndex(o => o.id === id);
    if (idx === -1) return null;
    const [removed] = this.layout.objects.splice(idx, 1);
    this.save();
    return removed;
  }

  updateObject(id: string, updates: Partial<PlacedObject>): void {
    const obj = this.layout.objects.find(o => o.id === id);
    if (!obj) return;
    Object.assign(obj, updates);
    this.save();
  }

  getObject(id: string): PlacedObject | undefined {
    return this.layout.objects.find(o => o.id === id);
  }

  // ── Zone operations ──────────────────────────────────────────────────────

  setZone(key: string, state: ZoneState): void {
    this.layout.zones[key] = state;
    this.save();
  }

  updateZone(key: string, updates: Partial<ZoneState>): void {
    const zone = this.layout.zones[key];
    if (!zone) return;
    Object.assign(zone, updates);
    this.save();
  }
}
