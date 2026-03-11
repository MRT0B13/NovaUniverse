import { WS_BASE, ACTION_ZONE_MAP, ACTION_META } from '../config/constants';
import { getStoredToken } from '../utils/auth';

export interface UniverseEvent {
  id: string;
  agent: string;
  action: string;
  zone: string;
  msg: string;
  detail?: string;
  amount?: number;
  token?: string;
  txHash?: string;
  icon: string;
  color: string;
  ts: number;
}

type EventHandler = (event: UniverseEvent) => void;

export class EventClient {
  private ws: WebSocket | null = null;
  private handlers: EventHandler[] = [];
  private reconnectTimer: number | null = null;
  private pollTimer: number | null = null;
  private lastId: string | null = null;
  private connected = false;

  onEvent(handler: EventHandler) {
    this.handlers.push(handler);
  }

  private emit(event: UniverseEvent) {
    this.handlers.forEach(h => h(event));
  }

  connect() {
    this.tryWebSocket();
  }

  private tryWebSocket() {
    const token = getStoredToken();
    if (!token) return;

    try {
      const url = `${WS_BASE}/ws/live?token=${token}`;
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.connected = true;
        this.stopPolling();
        console.log('[EventClient] WS connected');
      };

      this.ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === 'feed_event') {
            this.emit(this.normalize(data.data));
          }
        } catch { /* ignore malformed */ }
      };

      this.ws.onerror = () => {
        this.connected = false;
        this.startPolling();
      };

      this.ws.onclose = () => {
        this.connected = false;
        this.startPolling();
        // Retry WS after 15s
        this.reconnectTimer = window.setTimeout(() => this.tryWebSocket(), 15_000);
      };
    } catch {
      this.startPolling();
    }
  }

  private startPolling() {
    if (this.pollTimer !== null) return;
    this.pollFeed();
    this.pollTimer = window.setInterval(() => this.pollFeed(), 5_000);
  }

  private stopPolling() {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async pollFeed() {
    try {
      const token = getStoredToken();
      if (!token) return;

      const res = await fetch(
        `${WS_BASE.replace('wss://', 'https://').replace('ws://', 'http://')}/feed?limit=10`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) return;
      const items: any[] = await res.json();

      for (const item of items.reverse()) {
        if (item.id === this.lastId) break;
        this.emit(this.normalize(item));
      }
      if (items.length > 0) this.lastId = items[0].id;
    } catch { /* ignore */ }
  }

  private normalize(raw: any): UniverseEvent {
    // Map feed message type / action to zone
    const action = raw.action ?? raw.type ?? 'intel';
    const zone = ACTION_ZONE_MAP[action] ?? 'command_center';
    const meta = ACTION_META[action] ?? { icon: '🤖', label: action, color: '#888' };

    return {
      id: raw.id ?? String(Date.now() + Math.random()),
      agent: raw.agent ?? raw.from_agent ?? 'unknown',
      action,
      zone,
      msg: raw.msg ?? raw.summary ?? meta.label,
      detail: raw.detail,
      amount: raw.amount ?? null,
      token: raw.token ?? null,
      txHash: raw.txHash ?? raw.tx_hash ?? null,
      icon: raw.icon ?? meta.icon,
      color: raw.color ?? meta.color,
      ts: Date.now(),
    };
  }

  disconnect() {
    this.stopPolling();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  isConnected() { return this.connected; }
}
