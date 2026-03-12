/**
 * DevPalette — left-side asset browser panel.
 * Categorized by directory. Click an asset to enter placement mode.
 */

// Complete asset catalog — every GLB on disk, organized by category
const ASSET_CATALOG: Record<string, string[]> = {
  // ── Custom Blender hero assets ──
  custom: [
    'agora-plaza','burn-furnace','data-pillar','guard-tower','launch-pad',
    'lp-pool','nova-hq','nova-tower','rocket','satellite-array',
  ],
  // ── Commercial (Kenney City) ──
  commercial: [
    'building-a','building-b','building-c','building-d','building-e','building-f','building-g',
    'building-h','building-i','building-j','building-k','building-l','building-m','building-n',
    'building-skyscraper-a','building-skyscraper-b','building-skyscraper-c','building-skyscraper-d','building-skyscraper-e',
    'low-detail-building-a','low-detail-building-b','low-detail-building-c','low-detail-building-d','low-detail-building-e',
    'low-detail-building-f','low-detail-building-g','low-detail-building-h','low-detail-building-i','low-detail-building-j',
    'low-detail-building-k','low-detail-building-l','low-detail-building-m','low-detail-building-n',
    'low-detail-building-wide-a','low-detail-building-wide-b',
    'detail-awning','detail-awning-wide','detail-overhang','detail-overhang-wide','detail-parasol-a','detail-parasol-b',
  ],
  // ── Industrial ──
  industrial: [
    'building-a','building-b','building-c','building-d','building-e','building-f','building-g',
    'building-h','building-i','building-j','building-k','building-l','building-m','building-n',
    'building-o','building-p','building-q','building-r','building-s','building-t',
    'chimney-basic','chimney-small','chimney-medium','chimney-large','detail-tank',
  ],
  // ── Suburban ──
  suburban: [
    'building-type-a','building-type-b','building-type-c','building-type-d','building-type-e',
    'building-type-f','building-type-g','building-type-h','building-type-i','building-type-j',
    'building-type-k','building-type-l','building-type-m','building-type-n','building-type-o',
    'building-type-p','building-type-q','building-type-r','building-type-s','building-type-t','building-type-u',
    'tree-large','tree-small','planter',
    'fence','fence-1x2','fence-1x3','fence-1x4','fence-2x2','fence-2x3','fence-3x2','fence-3x3','fence-low',
    'path-long','path-short','path-stones-long','path-stones-short','path-stones-messy',
    'driveway-long','driveway-short',
  ],
  // ── Roads (full set) ──
  roads: [
    'road-straight','road-straight-barrier','road-straight-barrier-end','road-straight-barrier-half','road-straight-half',
    'road-bend','road-bend-barrier','road-bend-sidewalk','road-bend-square','road-bend-square-barrier',
    'road-curve','road-curve-barrier','road-curve-intersection','road-curve-intersection-barrier','road-curve-pavement',
    'road-intersection','road-intersection-barrier','road-intersection-line','road-intersection-path',
    'road-crossroad','road-crossroad-barrier','road-crossroad-line','road-crossroad-path',
    'road-crossing','road-roundabout','road-roundabout-barrier',
    'road-bridge','bridge-pillar','bridge-pillar-wide',
    'road-end','road-end-barrier','road-end-round','road-end-round-barrier',
    'road-side','road-side-barrier','road-side-entry','road-side-entry-barrier','road-side-exit','road-side-exit-barrier',
    'road-split','road-split-barrier','road-square','road-square-barrier',
    'road-slant','road-slant-barrier','road-slant-curve','road-slant-curve-barrier',
    'road-slant-flat','road-slant-flat-curve','road-slant-flat-high','road-slant-high','road-slant-high-barrier',
    'road-driveway-double','road-driveway-double-barrier','road-driveway-single','road-driveway-single-barrier',
    'tile-high','tile-low','tile-slant','tile-slantHigh',
    'light-curved','light-curved-cross','light-curved-double','light-square','light-square-cross','light-square-double',
    'construction-barrier','construction-cone','construction-light',
    'sign-highway','sign-highway-detailed','sign-highway-wide',
  ],
  // ── Cars & Vehicles ──
  cars: [
    'ambulance','delivery','delivery-flat','firetruck','garbage-truck',
    'hatchback-sports','police','race','race-future',
    'sedan','sedan-sports','suv','suv-luxury','taxi',
    'tractor','tractor-police','tractor-shovel',
    'truck','truck-flat','van',
    'kart-oobi','kart-oodi','kart-ooli','kart-oopi','kart-oozi',
    'box','cone','cone-flat',
  ],
  // ── Characters ──
  characters: [
    'character-a','character-b','character-c','character-d','character-e','character-f',
    'character-g','character-h','character-i','character-j','character-k','character-l',
    'character-m','character-n','character-o','character-p','character-q','character-r',
  ],
};

export type OnSelectAsset = (category: string, asset: string) => void;

export class DevPalette {
  private el: HTMLDivElement;
  private onSelect: OnSelectAsset;
  private activeBtn: HTMLButtonElement | null = null;

  constructor(parent: HTMLElement, onSelect: OnSelectAsset) {
    this.onSelect = onSelect;

    this.el = document.createElement('div');
    this.el.id = 'dev-palette';
    this.el.style.cssText = `
      position:fixed; left:0; top:40px; bottom:0; width:220px;
      background:rgba(0,0,0,0.92); border-right:1px solid #333;
      overflow-y:auto; font-family:'Space Mono',monospace; font-size:11px;
      color:#ccc; z-index:1001; padding:8px;
      scrollbar-width:thin; scrollbar-color:#444 transparent;
    `;

    const title = document.createElement('div');
    title.textContent = 'ASSET PALETTE';
    title.style.cssText = 'color:#fff; font-weight:bold; padding:4px 0 8px; font-size:12px; letter-spacing:1px;';
    this.el.appendChild(title);

    for (const [category, assets] of Object.entries(ASSET_CATALOG)) {
      const section = document.createElement('details');
      section.style.cssText = 'margin-bottom:4px;';

      const summary = document.createElement('summary');
      summary.textContent = category.toUpperCase();
      summary.style.cssText = `
        cursor:pointer; padding:4px 6px; background:#1a1a2e; border-radius:4px;
        color:#88aaff; font-weight:bold; font-size:10px; letter-spacing:1px;
        user-select:none;
      `;
      section.appendChild(summary);

      const list = document.createElement('div');
      list.style.cssText = 'padding:2px 0 4px 8px;';

      for (const asset of assets) {
        const btn = document.createElement('button');
        btn.textContent = asset;
        btn.dataset.category = category;
        btn.dataset.asset = asset;
        btn.style.cssText = `
          display:block; width:100%; text-align:left; padding:3px 6px; margin:1px 0;
          background:transparent; border:1px solid transparent; border-radius:3px;
          color:#aaa; cursor:pointer; font-family:inherit; font-size:10px;
          transition: background 0.15s, border-color 0.15s;
        `;
        btn.onmouseenter = () => { if (btn !== this.activeBtn) btn.style.background = '#222'; };
        btn.onmouseleave = () => { if (btn !== this.activeBtn) btn.style.background = 'transparent'; };
        btn.onclick = () => this.selectAsset(btn, category, asset);
        list.appendChild(btn);
      }

      section.appendChild(list);
      this.el.appendChild(section);
    }

    parent.appendChild(this.el);
  }

  private selectAsset(btn: HTMLButtonElement, category: string, asset: string) {
    if (this.activeBtn) {
      this.activeBtn.style.background = 'transparent';
      this.activeBtn.style.borderColor = 'transparent';
      this.activeBtn.style.color = '#aaa';
    }
    this.activeBtn = btn;
    btn.style.background = '#1a3a1a';
    btn.style.borderColor = '#00ff88';
    btn.style.color = '#00ff88';
    this.onSelect(category, asset);
  }

  clearSelection(): void {
    if (this.activeBtn) {
      this.activeBtn.style.background = 'transparent';
      this.activeBtn.style.borderColor = 'transparent';
      this.activeBtn.style.color = '#aaa';
      this.activeBtn = null;
    }
  }

  show(): void { this.el.style.display = 'block'; }
  hide(): void { this.el.style.display = 'none'; }

  dispose(): void {
    this.el.remove();
  }
}
