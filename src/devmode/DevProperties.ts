/**
 * DevProperties — right-side panel showing selected object properties.
 * Editable fields for position, rotation, scale.
 */

import type { PlacedObject, ZoneState } from './WorldState';

export type OnObjectChanged = (id: string, updates: Partial<PlacedObject>) => void;
export type OnZoneChanged = (key: string, updates: Partial<ZoneState>) => void;
export type OnDeleteObject = (id: string) => void;
export type OnDuplicateObject = (id: string) => void;

export class DevProperties {
  private el: HTMLDivElement;
  private content: HTMLDivElement;
  private onObjectChanged: OnObjectChanged;
  private onZoneChanged: OnZoneChanged;
  private onDelete: OnDeleteObject;
  private onDuplicate: OnDuplicateObject;

  constructor(
    parent: HTMLElement,
    onObjectChanged: OnObjectChanged,
    onZoneChanged: OnZoneChanged,
    onDelete: OnDeleteObject,
    onDuplicate: OnDuplicateObject,
  ) {
    this.onObjectChanged = onObjectChanged;
    this.onZoneChanged = onZoneChanged;
    this.onDelete = onDelete;
    this.onDuplicate = onDuplicate;

    this.el = document.createElement('div');
    this.el.id = 'dev-properties';
    this.el.style.cssText = `
      position:fixed; right:0; top:40px; bottom:0; width:240px;
      background:rgba(0,0,0,0.92); border-left:1px solid #333;
      overflow-y:auto; font-family:'Space Mono',monospace; font-size:11px;
      color:#ccc; z-index:1001; padding:8px;
      pointer-events:auto; touch-action:auto;
    `;
    // Stop all pointer events from propagating to the canvas behind
    for (const evt of ['pointerdown', 'pointermove', 'pointerup', 'click', 'mousedown', 'mouseup', 'touchstart', 'touchmove', 'touchend'] as const) {
      this.el.addEventListener(evt, e => e.stopPropagation());
    }

    const title = document.createElement('div');
    title.textContent = 'PROPERTIES';
    title.style.cssText = 'color:#fff; font-weight:bold; padding:4px 0 8px; font-size:12px; letter-spacing:1px;';
    this.el.appendChild(title);

    this.content = document.createElement('div');
    this.content.style.cssText = 'color:#666;';
    this.content.textContent = 'Select an object or zone';
    this.el.appendChild(this.content);

    parent.appendChild(this.el);
  }

  showObject(obj: PlacedObject): void {
    this.content.innerHTML = '';

    this.addLabel('Asset: ' + obj.asset);
    this.addLabel('ID: ' + obj.id, '#555', '9px');

    this.addSpacer();
    this.addField('X', obj.x, v => this.onObjectChanged(obj.id, { x: v }));
    this.addField('Z', obj.z, v => this.onObjectChanged(obj.id, { z: v }));
    this.addField('Rotation', +(obj.rotY * 180 / Math.PI).toFixed(1), v => this.onObjectChanged(obj.id, { rotY: v * Math.PI / 180 }));
    this.addField('Scale', obj.scale, v => this.onObjectChanged(obj.id, { scale: v }));

    this.addSpacer();
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex; gap:6px;';

    const dupBtn = this.createBtn('Duplicate', '#2a4a6a', () => this.onDuplicate(obj.id));
    const delBtn = this.createBtn('Delete', '#4a1a1a', () => this.onDelete(obj.id));
    delBtn.style.color = '#ff4444';

    btnRow.appendChild(dupBtn);
    btnRow.appendChild(delBtn);
    this.content.appendChild(btnRow);
  }

  showZone(key: string, zone: ZoneState): void {
    this.content.innerHTML = '';

    this.addLabel('Zone: ' + key);

    this.addSpacer();
    this.addTextField('Label', zone.label, v => this.onZoneChanged(key, { label: v }));
    this.addTextField('Icon', zone.icon, v => this.onZoneChanged(key, { icon: v }));
    this.addColorField('Color', zone.color, v => this.onZoneChanged(key, { color: v }));

    this.addSpacer();
    this.addField('Center X', zone.cx, v => this.onZoneChanged(key, { cx: v }));
    this.addField('Center Z', zone.cz, v => this.onZoneChanged(key, { cz: v }));
    this.addField('Width', zone.w, v => this.onZoneChanged(key, { w: v }));
    this.addField('Height', zone.h, v => this.onZoneChanged(key, { h: v }));
  }

  clearSelection(): void {
    this.content.innerHTML = '';
    this.content.textContent = 'Select an object or zone';
    this.content.style.color = '#666';
  }

  show(): void { this.el.style.display = 'block'; }
  hide(): void { this.el.style.display = 'none'; }
  dispose(): void { this.el.remove(); }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private addLabel(text: string, color = '#aaa', size = '11px') {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = `color:${color}; font-size:${size}; padding:2px 0;`;
    this.content.appendChild(el);
    this.content.style.color = '#ccc';
  }

  private addSpacer() {
    const el = document.createElement('div');
    el.style.cssText = 'height:8px; border-bottom:1px solid #222; margin-bottom:8px;';
    this.content.appendChild(el);
  }

  private addField(label: string, value: number, onChange: (v: number) => void) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; margin:3px 0;';

    const lbl = document.createElement('span');
    lbl.textContent = label;
    lbl.style.cssText = 'width:70px; color:#888; font-size:10px;';

    const input = document.createElement('input');
    input.type = 'number';
    input.step = label === 'Scale' ? '0.1' : label === 'Rotation' ? '45' : '0.5';
    input.value = String(+value.toFixed(2));
    input.style.cssText = `
      flex:1; background:#111; border:1px solid #333; border-radius:3px;
      color:#fff; padding:3px 6px; font-family:inherit; font-size:11px;
      outline:none;
    `;
    input.onfocus = () => { input.style.borderColor = '#00ff88'; };
    input.onblur = () => { input.style.borderColor = '#333'; };
    input.onchange = () => {
      const v = parseFloat(input.value);
      if (!isNaN(v)) onChange(v);
    };

    row.appendChild(lbl);
    row.appendChild(input);
    this.content.appendChild(row);
  }

  private addTextField(label: string, value: string, onChange: (v: string) => void) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; margin:3px 0;';

    const lbl = document.createElement('span');
    lbl.textContent = label;
    lbl.style.cssText = 'width:70px; color:#888; font-size:10px;';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.style.cssText = `
      flex:1; background:#111; border:1px solid #333; border-radius:3px;
      color:#fff; padding:3px 6px; font-family:inherit; font-size:11px; outline:none;
    `;
    input.onchange = () => onChange(input.value);

    row.appendChild(lbl);
    row.appendChild(input);
    this.content.appendChild(row);
  }

  private addColorField(label: string, value: number, onChange: (v: number) => void) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; margin:3px 0;';

    const lbl = document.createElement('span');
    lbl.textContent = label;
    lbl.style.cssText = 'width:70px; color:#888; font-size:10px;';

    const input = document.createElement('input');
    input.type = 'color';
    input.value = '#' + value.toString(16).padStart(6, '0');
    input.style.cssText = 'width:40px; height:24px; border:none; background:none; cursor:pointer;';
    input.onchange = () => onChange(parseInt(input.value.slice(1), 16));

    row.appendChild(lbl);
    row.appendChild(input);
    this.content.appendChild(row);
  }

  private createBtn(text: string, bg: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.style.cssText = `
      flex:1; padding:6px; background:${bg}; border:1px solid #444;
      border-radius:4px; color:#ccc; cursor:pointer; font-family:inherit; font-size:10px;
      pointer-events:auto; touch-action:manipulation; user-select:none;
    `;
    btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    btn.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch') { e.stopPropagation(); onClick(); }
    });
    return btn;
  }
}
