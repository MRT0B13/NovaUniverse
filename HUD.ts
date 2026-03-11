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

  constructor() {
    this.feed = document.getElementById('event-feed')!;
    this.tooltip = document.getElementById('agent-tooltip')!;
    this.zoneLabel = document.getElementById('zone-label')!;
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

    // Remove old items
    while (this.feedItems.length > MAX_FEED_ITEMS) {
      const old = this.feedItems.shift();
      old?.remove();
    }

    // Auto-expire
    setTimeout(() => {
      item.style.transition = 'opacity 0.5s';
      item.style.opacity = '0';
      setTimeout(() => {
        item.remove();
        this.feedItems = this.feedItems.filter(i => i !== item);
      }, 500);
    }, FEED_ITEM_LIFETIME);
  }

  showAgentTooltip(info: AgentInfo) {
    this.tooltip.innerHTML = `
      <div style="font-size:28px;margin-bottom:8px">${info.emoji}</div>
      <div class="name">${info.name}</div>
      <div class="role" style="color:${info.color}">${info.role}</div>
      <div class="stat-row"><span class="stat-label">Status</span><span class="stat-val" style="color:${info.status === 'running' ? '#00ff88' : '#ff9500'}">${info.status}</span></div>
      <div class="stat-row"><span class="stat-label">Messages 24h</span><span class="stat-val">${info.messages24h}</span></div>
      <div class="stat-row"><span class="stat-label">Zone</span><span class="stat-val">${info.zone}</span></div>
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

  private relTime(ts: number): string {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 10) return 'now';
    if (diff < 60) return diff + 's';
    return Math.floor(diff / 60) + 'm';
  }
}
