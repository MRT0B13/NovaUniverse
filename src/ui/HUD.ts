import { ZONES } from '../config/constants';
import type { UniverseEvent } from '../events/EventClient';

const MAX_FEED_ITEMS = 8;
const FEED_ITEM_LIFETIME = 12_000; // ms

interface AgentInfo {
  name: string;
  role: string;
  emoji: string;
  color: string;
  status: string;
  messages24h: number;
  zone: string;
}

export class HUD {
  private feed: HTMLElement;
  private tooltip: HTMLElement;
  private zoneLabel: HTMLElement;
  private feedItems: HTMLElement[] = [];
  private zonePanelEl: HTMLElement | null = null;

  // Timeline (Task 5)
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
    el('stat-nova')!.textContent = stats.nova.toLocaleString();
    el('hud-wallet')!.textContent = stats.address
      ? stats.address.slice(0, 6) + '…' + stats.address.slice(-4)
      : '';
  }

  pushEvent(event: UniverseEvent) {
    const item = document.createElement('div');
    item.className = 'feed-item';
    item.innerHTML = `
      <span class="icon">${event.icon}</span>
      <div class="text">
        <span class="agent-name" style="color:${event.color}">${event.agent.replace('nova-', '').toUpperCase()}</span>
        <span class="msg">${event.msg}</span>
      </div>
      <span class="time">${this.relTime(event.ts)}</span>
    `;

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

    // Add to timeline
    if (this.isLive) {
      this.timelineEvents.push(event);
      if (this.timelineEvents.length > 50) this.timelineEvents.shift();
      this.renderTimelineDots();
      this.setTimelinePosition(1); // keep at live end
    }
  }

  showAgentTooltip(info: AgentInfo, messages: string[] = []) {
    let messagesHtml = '';
    if (messages.length > 0) {
      const msgItems = messages
        .map(m => `<div style="font-family:'Space Mono',monospace;font-size:9px;color:#777;padding:4px 0;border-bottom:1px solid #1a1a1a;word-break:break-word;">${m}</div>`)
        .join('');
      messagesHtml = `
        <div style="margin-top:12px;border-top:1px solid #222;padding-top:8px;">
          <div style="font-family:'Space Mono',monospace;font-size:8px;color:#444;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;">Recent Messages</div>
          ${msgItems}
        </div>
      `;
    }

    this.tooltip.innerHTML = `
      <div style="font-size:28px;margin-bottom:8px">${info.emoji}</div>
      <div class="name">${info.name}</div>
      <div class="role" style="color:${info.color}">${info.role}</div>
      <div class="stat-row"><span class="stat-label">Status</span><span class="stat-val" style="color:${info.status === 'running' ? '#00ff88' : '#ff9500'}">${info.status}</span></div>
      <div class="stat-row"><span class="stat-label">Messages 24h</span><span class="stat-val">${info.messages24h}</span></div>
      <div class="stat-row"><span class="stat-label">Zone</span><span class="stat-val">${info.zone}</span></div>
      ${messagesHtml}
    `;
    this.tooltip.classList.add('visible');
  }

  hideAgentTooltip() {
    this.tooltip.classList.remove('visible');
  }

  showZoneLabel(label: string, x: number, y: number) {
    this.zoneLabel.textContent = label;
    this.zoneLabel.style.left = x + 'px';
    this.zoneLabel.style.top = y + 'px';
    this.zoneLabel.style.display = 'block';
  }

  hideZoneLabel() {
    this.zoneLabel.style.display = 'none';
  }

  // ── ZONE DRILL-DOWN PANEL (Task 3) ────────────────────────────────────────

  showZonePanel(zoneKey: string, data: any) {
    this.hideZonePanel();

    const zone = ZONES[zoneKey];
    if (!zone) return;

    const panel = document.createElement('div');
    panel.id = 'zone-panel';
    panel.style.cssText = `
      position:absolute;top:56px;right:-380px;width:360px;
      max-height:calc(100vh - 80px);overflow-y:auto;
      background:rgba(10,10,10,0.96);border:1px solid #1a1a1a;
      border-radius:8px;padding:20px;z-index:20;pointer-events:all;
      transition:right 0.3s ease-out;
    `;

    const colorHex = '#' + zone.borderColor.toString(16).padStart(6, '0');

    let bodyHtml = this.buildZonePanelBody(zoneKey, data);

    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <div>
          <div style="font-family:'Syne',sans-serif;font-weight:700;font-size:15px;color:#fff;">${zone.icon} ${zone.label}</div>
          <div style="font-family:'Space Mono',monospace;font-size:8px;color:#555;text-transform:uppercase;letter-spacing:0.1em;margin-top:2px;">${zone.description}</div>
        </div>
        <div id="zone-panel-close" style="cursor:pointer;color:#555;font-size:18px;padding:4px 8px;">✕</div>
      </div>
      <div style="border-top:1px solid ${colorHex}33;padding-top:12px;">
        ${bodyHtml}
      </div>
    `;

    document.getElementById('hud')!.appendChild(panel);
    this.zonePanelEl = panel;

    // Slide in
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { panel.style.right = '12px'; });
    });

    panel.querySelector('#zone-panel-close')!.addEventListener('click', () => this.hideZonePanel());
  }

  hideZonePanel() {
    if (this.zonePanelEl) {
      this.zonePanelEl.style.right = '-380px';
      const el = this.zonePanelEl;
      setTimeout(() => el.remove(), 300);
      this.zonePanelEl = null;
    }
  }

  private buildZonePanelBody(zoneKey: string, data: any): string {
    if (!data) return '<div style="font-family:\'Space Mono\',monospace;font-size:10px;color:#555;">No data available</div>';

    const row = (label: string, value: string, color = '#bbb') =>
      `<div style="display:flex;justify-content:space-between;margin-bottom:6px;">
         <span style="font-family:'Space Mono',monospace;font-size:9px;color:#555;">${label}</span>
         <span style="font-family:'Space Mono',monospace;font-size:9px;color:${color};">${value}</span>
       </div>`;

    const sectionTitle = (t: string) =>
      `<div style="font-family:'Space Mono',monospace;font-size:8px;color:#444;text-transform:uppercase;letter-spacing:0.1em;margin:12px 0 8px;">${t}</div>`;

    switch (zoneKey) {
      case 'trading_floor': {
        const pf = data.portfolio;
        const tx = data.transactions;
        let html = sectionTitle('Portfolio');
        html += row('Total Value', pf ? '$' + (pf.totalValue ?? pf.total_value ?? 0).toLocaleString() : '—', '#00ff88');
        html += row('NOVA Balance', pf ? String(pf.nova ?? pf.nova_balance ?? 0) : '—', '#c084fc');
        html += sectionTitle('Transactions');
        html += row('Today', tx ? String(tx.today ?? tx.count_today ?? 0) : '—');
        return html;
      }
      case 'intel_hub': {
        const items = Array.isArray(data) ? data : [];
        let html = sectionTitle('Recent Signals');
        if (items.length === 0) html += row('No signals', '');
        items.slice(0, 5).forEach((it: any) => {
          html += `<div style="font-family:'Space Mono',monospace;font-size:9px;color:#888;padding:4px 0;border-bottom:1px solid #111;">${it.msg ?? it.summary ?? it.action ?? '...'}</div>`;
        });
        return html;
      }
      case 'watchtower': {
        let html = sectionTitle('Health Overview');
        if (data && typeof data === 'object') {
          Object.entries(data).forEach(([k, v]) => {
            html += row(k, String(v));
          });
        } else {
          html += row('Status', 'Operational', '#00ff88');
        }
        return html;
      }
      case 'launchpad': {
        const items = Array.isArray(data) ? data : (data?.launches ?? []);
        let html = sectionTitle('Recent Launches');
        if (items.length === 0) html += row('No launches yet', '');
        items.slice(0, 5).forEach((it: any) => {
          html += row(it.name ?? it.token ?? 'Token', it.price ? '$' + it.price : '—', '#f472b6');
        });
        return html;
      }
      case 'agora': {
        const items = Array.isArray(data) ? data : (data?.proposals ?? []);
        let html = sectionTitle('Active Proposals');
        if (items.length === 0) html += row('No proposals', '');
        items.slice(0, 5).forEach((it: any) => {
          html += `<div style="font-family:'Space Mono',monospace;font-size:9px;color:#ffd700;padding:4px 0;border-bottom:1px solid #111;">${it.title ?? it.name ?? '...'}</div>`;
        });
        return html;
      }
      case 'burn_furnace': {
        let html = sectionTitle('Burn Stats');
        if (data && typeof data === 'object') {
          html += row('Total Burned', String(data.total_burned ?? data.totalBurned ?? 0), '#ff4444');
          html += row('Credits Issued', String(data.credits_issued ?? data.creditsIssued ?? 0));
        } else {
          html += row('Data unavailable', '');
        }
        return html;
      }
      case 'command_center': {
        let html = sectionTitle('Supervisor Status');
        if (data && typeof data === 'object') {
          Object.entries(data).forEach(([k, v]) => {
            html += row(k, String(v));
          });
        } else {
          html += row('Status', 'Active', '#c084fc');
        }
        return html;
      }
      case 'orca_pool': {
        let html = sectionTitle('Orca Pool LP');
        if (data && typeof data === 'object') {
          html += row('Total Value', data.totalValue ? '$' + data.totalValue.toLocaleString() : '—', '#00ff88');
        } else {
          html += row('Data unavailable', '');
        }
        return html;
      }
      default:
        return row('Zone', zoneKey);
    }
  }

  // ── TIMELINE SCRUBBER (Task 5) ────────────────────────────────────────────

  setReplayHandler(handler: (event: UniverseEvent) => void) {
    this.onReplayEvent = handler;
  }

  loadTimelineEvents(events: UniverseEvent[]) {
    this.timelineEvents = events.slice(-50);
    this.renderTimelineDots();
    this.setTimelinePosition(1);
  }

  private initTimeline() {
    const timeline = document.getElementById('timeline')!;
    if (!timeline) return;

    this.timelineTrack = document.getElementById('timeline-track')!;
    this.timelineThumb = document.getElementById('timeline-thumb')!;
    this.timelineLabel = document.getElementById('timeline-label')!;
    this.timelineLiveBtn = document.getElementById('timeline-live')!;

    if (!this.timelineTrack) return;

    let dragging = false;

    const updatePos = (clientX: number) => {
      const rect = this.timelineTrack.getBoundingClientRect();
      let ratio = (clientX - rect.left) / rect.width;
      ratio = Math.max(0, Math.min(1, ratio));
      this.setTimelinePosition(ratio);

      // Find closest event
      if (this.timelineEvents.length > 0) {
        const idx = Math.round(ratio * (this.timelineEvents.length - 1));
        const ev = this.timelineEvents[idx];
        if (ev) {
          this.timelineLabel.textContent = `${ev.icon} ${ev.agent.replace('nova-', '').toUpperCase()}: ${ev.msg}`;
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

    window.addEventListener('mousemove', (e) => {
      if (dragging) updatePos(e.clientX);
    });

    window.addEventListener('mouseup', () => { dragging = false; });

    // Hover dots
    this.timelineTrack.addEventListener('mousemove', (e) => {
      if (dragging) return;
      const rect = this.timelineTrack.getBoundingClientRect();
      let ratio = (e.clientX - rect.left) / rect.width;
      ratio = Math.max(0, Math.min(1, ratio));
      if (this.timelineEvents.length > 0) {
        const idx = Math.round(ratio * (this.timelineEvents.length - 1));
        const ev = this.timelineEvents[idx];
        if (ev) {
          this.timelineLabel.textContent = `${ev.icon} ${ev.agent.replace('nova-', '').toUpperCase()}: ${ev.msg}`;
        }
      }
    });

    this.timelineTrack.addEventListener('mouseleave', () => {
      if (!dragging) this.timelineLabel.textContent = this.isLive ? 'LIVE' : '';
    });

    // Live button
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
    // Remove old dots
    this.timelineTrack.querySelectorAll('.tl-dot').forEach(d => d.remove());

    const count = this.timelineEvents.length;
    if (count === 0) return;

    this.timelineEvents.forEach((ev, i) => {
      const dot = document.createElement('div');
      dot.className = 'tl-dot';
      const pct = count > 1 ? (i / (count - 1)) * 100 : 50;
      dot.style.cssText = `
        position:absolute;top:50%;left:${pct}%;
        width:4px;height:4px;border-radius:50%;
        background:${ev.color};opacity:0.6;
        transform:translate(-50%,-50%);pointer-events:none;
      `;
      this.timelineTrack.appendChild(dot);
    });
  }

  private relTime(ts: number): string {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 10) return 'now';
    if (diff < 60) return diff + 's';
    return Math.floor(diff / 60) + 'm';
  }
}
