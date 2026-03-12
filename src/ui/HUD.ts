import { ZONES } from '../config/constants';
import type { UniverseEvent } from '../events/EventClient';
import type { WeatherState } from '../world/WeatherSystem';

const MAX_FEED_ITEMS = 6;
const FEED_ITEM_LIFETIME = 8_000;

interface AgentInfo {
  name: string;
  role: string;
  emoji: string;
  color: string;
  status: string;
  messages24h: number;
  zone: string;
  messages?: string[];
}

export class HUD {
  private feed: HTMLElement;
  private tooltip: HTMLElement;
  private zoneLabel: HTMLElement;
  private feedItems: HTMLElement[] = [];
  private zonePanelEl: HTMLElement | null = null;

  // Timeline
  private timelineEvents: UniverseEvent[] = [];
  private timelineTrack!: HTMLElement;
  private timelineThumb!: HTMLElement;
  private timelineLabel!: HTMLElement;
  private timelineLiveBtn!: HTMLElement;
  private isLive = true;
  private onReplayEvent: ((event: UniverseEvent) => void) | null = null;

  constructor() {
    this.feed = document.getElementById('event-feed')!;
    this.tooltip = document.getElementById('agent-tooltip')!;
    this.zoneLabel = document.getElementById('zone-label')!;
    this.initTimeline();
  }

  show() {
    document.getElementById('hud')!.classList.add('visible');
  }

  // ── LOADING BAR ────────────────────────────────────────────────────────────

  showLoadingBar(msg = 'Loading…') {
    const bar = document.getElementById('loading-bar');
    const label = document.getElementById('loading-label');
    if (bar) bar.classList.add('visible');
    if (label) label.textContent = msg;
    this.updateLoadingProgress(0);
  }

  hideLoadingBar() {
    const bar = document.getElementById('loading-bar');
    if (bar) bar.classList.remove('visible');
  }

  updateLoadingProgress(pct: number) {
    const fill = document.getElementById('loading-bar-fill');
    if (fill) fill.style.width = Math.min(100, Math.max(0, pct)) + '%';
  }

  updateStats(stats: {
    portfolio: number;
    agents: number;
    txs: number;
    nova: number;
    address: string;
  }) {
    const el = (id: string) => document.getElementById(id);
    el('stat-portfolio')!.textContent = '$' + stats.portfolio.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    el('stat-agents')!.textContent = String(stats.agents);
    el('stat-txs')!.textContent = String(stats.txs);
    el('stat-nova')!.textContent = typeof stats.nova === 'number' ? stats.nova.toLocaleString() : String(stats.nova);
    el('hud-wallet')!.textContent = stats.address
      ? stats.address.slice(0, 6) + '\u2026' + stats.address.slice(-4)
      : '';
  }

  pushEvent(event: UniverseEvent) {
    const item = document.createElement('div');
    item.className = 'feed-item';
    item.innerHTML =
      '<span class="icon">' + event.icon + '</span>' +
      '<div class="text">' +
        '<span class="agent-name" style="color:' + event.color + '">' + event.agent.replace('nova-', '').toUpperCase() + '</span>' +
        '<span class="msg">' + event.msg + '</span>' +
      '</div>' +
      '<span class="time">' + this.relTime(event.ts) + '</span>';

    this.feed.prepend(item);
    this.feedItems.push(item);

    while (this.feedItems.length > MAX_FEED_ITEMS) {
      const old = this.feedItems.shift();
      old?.remove();
    }

    setTimeout(() => {
      item.style.transition = 'opacity 0.5s';
      item.style.opacity = '0';
      setTimeout(() => {
        item.remove();
        this.feedItems = this.feedItems.filter(i => i !== item);
      }, 500);
    }, FEED_ITEM_LIFETIME);

    // Timeline live append
    if (this.isLive) {
      this.timelineEvents.push(event);
      if (this.timelineEvents.length > 50) this.timelineEvents.shift();
      this.renderTimelineDots();
      this.setTimelinePosition(1);
    }
  }

  // ── AGENT TOOLTIP ──────────────────────────────────────────────────────────

  showAgentTooltip(info: AgentInfo) {
    const msgs = info.messages ?? [];
    let msgsHtml = '';
    if (msgs.length > 0) {
      msgsHtml =
        '<div style="margin-top:10px;padding-top:10px;border-top:1px solid #1a1a1a">' +
        '<div style="font-family:\'Space Mono\',monospace;font-size:8px;color:#555;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px">Last Activity</div>' +
        msgs.map(m => '<div style="font-family:\'Space Mono\',monospace;font-size:9px;color:#888;padding:3px 0;border-bottom:1px solid #0a0a0a">' + m + '</div>').join('') +
        '</div>';
    }

    this.tooltip.innerHTML =
      '<div style="font-size:26px;margin-bottom:8px">' + info.emoji + '</div>' +
      '<div class="name">' + info.name + '</div>' +
      '<div class="role" style="color:' + info.color + '">' + info.role + '</div>' +
      '<div class="stat-row"><span class="stat-label">Status</span><span class="stat-val" style="color:' + (info.status === 'running' ? '#00ff88' : '#ff9500') + '">' + info.status + '</span></div>' +
      '<div class="stat-row"><span class="stat-label">Messages 24h</span><span class="stat-val">' + info.messages24h + '</span></div>' +
      '<div class="stat-row"><span class="stat-label">Zone</span><span class="stat-val">' + info.zone + '</span></div>' +
      msgsHtml;
    this.tooltip.classList.add('visible');
  }

  hideAgentTooltip() {
    this.tooltip.classList.remove('visible');
  }

  // ── ZONE LABEL ─────────────────────────────────────────────────────────────

  showZoneLabel(label: string, x: number, y: number) {
    this.zoneLabel.textContent = label;
    this.zoneLabel.style.left = x + 'px';
    this.zoneLabel.style.top = y + 'px';
    this.zoneLabel.style.display = 'block';
  }

  hideZoneLabel() {
    this.zoneLabel.style.display = 'none';
  }

  // ── ZONE DRILL-DOWN PANEL ─────────────────────────────────────────────────

  showZonePanel(zoneKey: string, zoneLabel: string, color: string) {
    this.hideZonePanel();

    const panel = document.createElement('div');
    panel.id = 'zone-panel';
    panel.style.cssText =
      'position:absolute;top:56px;right:16px;width:280px;' +
      'background:rgba(10,10,10,0.96);border:1px solid #1a1a1a;' +
      'border-radius:8px;padding:16px;pointer-events:all;' +
      'transform:translateX(320px);transition:transform 0.3s ease;' +
      'z-index:15;max-height:calc(100vh - 80px);overflow-y:auto;';

    panel.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
        '<div style="font-family:\'Syne\',sans-serif;font-weight:700;font-size:13px;color:' + color + '">' + zoneLabel + '</div>' +
        '<div id="zone-panel-close" style="cursor:pointer;color:#555;font-size:16px;pointer-events:all">\u00d7</div>' +
      '</div>' +
      '<div id="zone-panel-content" style="font-family:\'Space Mono\',monospace;font-size:10px;color:#555">' +
        'Loading\u2026' +
      '</div>';

    document.getElementById('hud')!.appendChild(panel);
    this.zonePanelEl = panel;

    requestAnimationFrame(() => {
      panel.style.transform = 'translateX(0)';
    });

    panel.querySelector('#zone-panel-close')?.addEventListener('click', () => this.hideZonePanel());
  }

  hideZonePanel() {
    if (this.zonePanelEl) {
      this.zonePanelEl.style.transform = 'translateX(320px)';
      const el = this.zonePanelEl;
      setTimeout(() => el.remove(), 300);
      this.zonePanelEl = null;
    }
  }

  updateZonePanelContent(html: string) {
    const content = document.getElementById('zone-panel-content');
    if (content) content.innerHTML = html;
  }

  // ── TIMELINE ──────────────────────────────────────────────────────────────

  setReplayHandler(handler: (event: UniverseEvent) => void) {
    this.onReplayEvent = handler;
  }

  loadTimelineEvents(events: UniverseEvent[]) {
    this.timelineEvents = events.slice(-50);
    this.renderTimelineDots();
    this.setTimelinePosition(1);
  }

  initTimeline(events?: any[]) {
    this.timelineTrack = document.getElementById('timeline-track')!;
    this.timelineThumb = document.getElementById('timeline-thumb')!;
    this.timelineLabel = document.getElementById('timeline-label')!;
    this.timelineLiveBtn = document.getElementById('timeline-live')!;

    if (!this.timelineTrack) return;

    // If historical events passed in, render them
    if (events && events.length > 0) {
      this.timelineTrack.innerHTML = '';
      events.forEach((event: any, i: number) => {
        const pct = events.length > 1 ? (i / (events.length - 1)) * 100 : 50;
        const dot = document.createElement('div');
        dot.style.cssText =
          'position:absolute;left:' + pct + '%;top:50%;' +
          'transform:translate(-50%,-50%);' +
          'width:6px;height:6px;border-radius:50%;' +
          'background:' + (event.color ?? '#333') + ';' +
          'cursor:pointer;transition:transform 0.15s;';
        dot.title = (event.agent ?? '') + ': ' + (event.msg ?? '');
        dot.addEventListener('mouseenter', () => {
          if (this.timelineLabel) {
            this.timelineLabel.textContent = (event.agent ?? '') + ' \u2014 ' + (event.msg ?? '');
          }
          dot.style.transform = 'translate(-50%,-50%) scale(2)';
        });
        dot.addEventListener('mouseleave', () => {
          dot.style.transform = 'translate(-50%,-50%) scale(1)';
        });
        this.timelineTrack.appendChild(dot);
      });
    }

    let dragging = false;

    const updatePos = (clientX: number) => {
      const rect = this.timelineTrack.getBoundingClientRect();
      let ratio = (clientX - rect.left) / rect.width;
      ratio = Math.max(0, Math.min(1, ratio));
      this.setTimelinePosition(ratio);

      if (this.timelineEvents.length > 0) {
        const idx = Math.round(ratio * (this.timelineEvents.length - 1));
        const ev = this.timelineEvents[idx];
        if (ev) {
          this.timelineLabel.textContent = ev.icon + ' ' + ev.agent.replace('nova-', '').toUpperCase() + ': ' + ev.msg;
          this.isLive = ratio >= 0.98;
          this.timelineLiveBtn.style.color = this.isLive ? '#00ff88' : '#555';
          if (this.onReplayEvent && !this.isLive) {
            this.onReplayEvent(ev);
          }
        }
      }
    };

    this.timelineTrack.addEventListener('mousedown', (e) => {
      dragging = true;
      this.isLive = false;
      updatePos(e.clientX);
    });
    window.addEventListener('mousemove', (e) => { if (dragging) updatePos(e.clientX); });
    window.addEventListener('mouseup', () => { dragging = false; });

    this.timelineTrack.addEventListener('mousemove', (e) => {
      if (dragging) return;
      const rect = this.timelineTrack.getBoundingClientRect();
      let ratio = (e.clientX - rect.left) / rect.width;
      ratio = Math.max(0, Math.min(1, ratio));
      if (this.timelineEvents.length > 0) {
        const idx = Math.round(ratio * (this.timelineEvents.length - 1));
        const ev = this.timelineEvents[idx];
        if (ev) {
          this.timelineLabel.textContent = ev.icon + ' ' + ev.agent.replace('nova-', '').toUpperCase() + ': ' + ev.msg;
        }
      }
    });

    this.timelineTrack.addEventListener('mouseleave', () => {
      if (!dragging) this.timelineLabel.textContent = this.isLive ? 'LIVE' : '';
    });

    this.timelineLiveBtn?.addEventListener('click', () => {
      this.isLive = true;
      this.setTimelinePosition(1);
      this.timelineLabel.textContent = 'LIVE';
      this.timelineLiveBtn.style.color = '#00ff88';
    });
  }

  private setTimelinePosition(ratio: number) {
    if (!this.timelineThumb) return;
    this.timelineThumb.style.left = (ratio * 100) + '%';
  }

  private renderTimelineDots() {
    if (!this.timelineTrack) return;
    this.timelineTrack.querySelectorAll('.tl-dot').forEach(d => d.remove());
    const count = this.timelineEvents.length;
    if (count === 0) return;

    this.timelineEvents.forEach((ev, i) => {
      const dot = document.createElement('div');
      dot.className = 'tl-dot';
      const pct = count > 1 ? (i / (count - 1)) * 100 : 50;
      dot.style.cssText =
        'position:absolute;top:50%;left:' + pct + '%;' +
        'width:4px;height:4px;border-radius:50%;' +
        'background:' + ev.color + ';opacity:0.6;' +
        'transform:translate(-50%,-50%);pointer-events:none;';
      this.timelineTrack.appendChild(dot);
    });
  }

  private relTime(ts: number): string {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 10) return 'now';
    if (diff < 60) return diff + 's';
    return Math.floor(diff / 60) + 'm';
  }

  // ── WEATHER PANEL ─────────────────────────────────────────────────────────

  createWeatherPanel(onSetWeather: (w: WeatherState) => void, onGetTime: () => number) {
    const panel = document.createElement('div');
    panel.id = 'weather-panel';
    panel.style.cssText =
      'position:absolute;bottom:48px;left:16px;' +
      'background:rgba(6,6,6,0.92);border:1px solid #1a1a2a;' +
      'border-radius:6px;padding:12px 16px;pointer-events:all;' +
      'font-family:"Space Mono",monospace;font-size:10px;' +
      'display:none;z-index:20;';

    const states: WeatherState[] = ['clear', 'overcast', 'rain', 'storm'];
    const icons: Record<string, string> = { clear: '\u2600\uFE0F', overcast: '\u2601\uFE0F', rain: '\uD83C\uDF27\uFE0F', storm: '\u26C8\uFE0F' };

    let buttonsHtml = '';
    for (const s of states) {
      buttonsHtml +=
        '<button data-weather="' + s + '" style="' +
        'background:#111;border:1px solid #222;border-radius:4px;' +
        'padding:4px 8px;cursor:pointer;color:#888;font-size:10px;' +
        'font-family:\'Space Mono\',monospace;pointer-events:all;' +
        '">' + icons[s] + ' ' + s + '</button>';
    }

    panel.innerHTML =
      '<div style="color:#555;text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px">Weather</div>' +
      '<div style="display:flex;gap:8px;margin-bottom:10px">' + buttonsHtml + '</div>' +
      '<div style="color:#555;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px">Time of Day</div>' +
      '<div id="time-display" style="color:#00ff88">14:00</div>';

    panel.querySelectorAll('button[data-weather]').forEach(btn => {
      btn.addEventListener('click', () => {
        const w = (btn as HTMLElement).dataset.weather as WeatherState;
        onSetWeather(w);
        panel.querySelectorAll('button').forEach(b =>
          (b as HTMLElement).style.borderColor = b === btn ? '#00ff88' : '#222'
        );
      });
    });

    document.getElementById('hud')!.appendChild(panel);

    // Update time display each second
    setInterval(() => {
      const h = onGetTime();
      const hours   = Math.floor(h).toString().padStart(2, '0');
      const minutes = Math.floor((h % 1) * 60).toString().padStart(2, '0');
      const el = document.getElementById('time-display');
      if (el) el.textContent = hours + ':' + minutes;
    }, 1000);

    // W key toggles panel
    window.addEventListener('keydown', e => {
      if (e.key === 'w' || e.key === 'W') {
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      }
    });
  }
}
