/**
 * DevPalette — left-side asset browser panel.
 * Categorized by directory. Click an asset to enter placement mode.
 */

const ASSET_CATALOG: Record<string, string[]> = {
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
  industrial: [
    'building-a','building-b','building-c','building-d','building-e','building-f','building-g',
    'building-h','building-i','building-j','building-k','building-l','building-m','building-n',
    'building-o','building-p','building-q','building-r','building-s','building-t',
    'chimney-basic','chimney-small','chimney-medium','chimney-large','detail-tank',
  ],
  suburban: [
    'building-type-a','building-type-b','building-type-c','building-type-d','building-type-e',
    'building-type-f','building-type-g','building-type-h','building-type-i','building-type-j',
    'building-type-k','building-type-l','building-type-m','building-type-n','building-type-o',
    'building-type-p','building-type-q','building-type-r','building-type-s','building-type-t','building-type-u',
    'tree-large','tree-small','planter',
    'fence','fence-1x2','fence-1x3','fence-1x4','fence-low',
    'path-long','path-short','path-stones-long','path-stones-short','path-stones-messy',
    'driveway-long','driveway-short',
  ],
  roads: [
    'road-straight','road-straight-barrier','road-bend','road-bend-sidewalk','road-curve','road-curve-barrier',
    'road-intersection','road-intersection-barrier','road-crossroad','road-crossroad-barrier',
    'road-roundabout','road-bridge','road-end','road-end-round',
    'light-curved','light-curved-double','light-square','light-square-double',
    'construction-barrier','construction-cone','construction-light',
    'sign-highway','sign-highway-detailed',
  ],
  custom: [
    'nova-tower','nova-hq','nova-bank','satellite-array','guard-tower',
    'agora-plaza','burn-furnace','launch-pad','rocket','lp-pool','data-pillar',
  ],
  cars: [
    'sedan','sedan-sports','suv','suv-luxury','taxi','police','ambulance','firetruck',
    'delivery','van','truck','truck-flat','garbage-truck','hatchback-sports','race','tractor',
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
