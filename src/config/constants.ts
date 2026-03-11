// ─── API ──────────────────────────────────────────────────────────────────────
export const API_BASE = import.meta.env.VITE_API_URL
  ?? 'https://enthusiastic-respect-production-3521.up.railway.app/api';

export const WS_BASE = API_BASE
  .replace('https://', 'wss://')
  .replace('http://', 'ws://');

// ─── AGENT DEFINITIONS ────────────────────────────────────────────────────────
export const AGENT_DEFS: Record<string, {
  label: string;
  emoji: string;
  color: number;       // Phaser hex int
  cssColor: string;    // CSS string
  role: string;
  zone: string;        // default home zone key
}> = {
  'nova-cfo': {
    label: 'Nova CFO',
    emoji: '💹',
    color: 0x00ff88,
    cssColor: '#00ff88',
    role: 'Capital Allocator',
    zone: 'trading_floor',
  },
  'nova-scout': {
    label: 'Nova Scout',
    emoji: '📡',
    color: 0x00c8ff,
    cssColor: '#00c8ff',
    role: 'Intel Gatherer',
    zone: 'intel_hub',
  },
  'nova-guardian': {
    label: 'Nova Guardian',
    emoji: '🛡️',
    color: 0xff9500,
    cssColor: '#ff9500',
    role: 'Risk Sentinel',
    zone: 'watchtower',
  },
  'nova-supervisor': {
    label: 'Nova Supervisor',
    emoji: '🧠',
    color: 0xc084fc,
    cssColor: '#c084fc',
    role: 'Swarm Orchestrator',
    zone: 'command_center',
  },
  'nova-analyst': {
    label: 'Nova Analyst',
    emoji: '📊',
    color: 0x00c8ff,
    cssColor: '#00c8ff',
    role: 'DeFi Analyst',
    zone: 'intel_hub',
  },
  'nova-launcher': {
    label: 'Nova Launcher',
    emoji: '🚀',
    color: 0xf472b6,
    cssColor: '#f472b6',
    role: 'Token Launcher',
    zone: 'launchpad',
  },
  'nova-community': {
    label: 'Nova Community',
    emoji: '🌐',
    color: 0xffd700,
    cssColor: '#ffd700',
    role: 'Community Manager',
    zone: 'agora',
  },
};

// ─── ZONE DEFINITIONS ─────────────────────────────────────────────────────────
// World is on a ~2400×1800 canvas. Zones are rectangular areas.
export const ZONES: Record<string, {
  label: string;
  x: number; y: number;     // centre
  w: number; h: number;     // dimensions
  color: number;            // floor tint
  borderColor: number;
  icon: string;
  description: string;
}> = {
  trading_floor: {
    label: 'Trading Floor',
    x: 600, y: 500,
    w: 420, h: 320,
    color: 0x001a0d,
    borderColor: 0x00ff88,
    icon: '💹',
    description: 'Orca LP · Kamino · Hyperliquid perps',
  },
  intel_hub: {
    label: 'Intel Hub',
    x: 1200, y: 400,
    w: 360, h: 280,
    color: 0x001622,
    borderColor: 0x00c8ff,
    icon: '📡',
    description: 'KOL tracking · Narrative signals · Alpha feed',
  },
  watchtower: {
    label: 'Watchtower',
    x: 1800, y: 450,
    w: 300, h: 260,
    color: 0x1a0d00,
    borderColor: 0xff9500,
    icon: '🛡️',
    description: 'RugCheck · Risk monitoring · Guardian',
  },
  command_center: {
    label: 'Command Center',
    x: 1200, y: 900,
    w: 380, h: 300,
    color: 0x110022,
    borderColor: 0xc084fc,
    icon: '🧠',
    description: 'Supervisor · Swarm decisions · Coordination',
  },
  launchpad: {
    label: 'Launchpad',
    x: 600, y: 1100,
    w: 360, h: 280,
    color: 0x1a0010,
    borderColor: 0xf472b6,
    icon: '🚀',
    description: 'pump.fun launches · Token factory · Mascot lab',
  },
  agora: {
    label: 'Agora',
    x: 1800, y: 1000,
    w: 320, h: 260,
    color: 0x1a1500,
    borderColor: 0xffd700,
    icon: '🌐',
    description: 'Community · Telegram · Governance',
  },
  orca_pool: {
    label: 'Orca Pool',
    x: 380, y: 700,
    w: 200, h: 160,
    color: 0x001510,
    borderColor: 0x00ff88,
    icon: '🌊',
    description: 'Orca CLMM · LP positions',
  },
  burn_furnace: {
    label: 'Burn Furnace',
    x: 1800, y: 1300,
    w: 260, h: 200,
    color: 0x1a0800,
    borderColor: 0xff4444,
    icon: '🔥',
    description: 'Token burns · Credit system',
  },
};

// ─── ACTION → ANIMATION MAPPING ───────────────────────────────────────────────
export const ACTION_ZONE_MAP: Record<string, string> = {
  lp_open: 'orca_pool',
  lp_close: 'trading_floor',
  lp_rebalanced: 'orca_pool',
  swap: 'trading_floor',
  hl_perp_open: 'trading_floor',
  hl_perp_close: 'trading_floor',
  kamino_loop: 'trading_floor',
  signal_detected: 'intel_hub',
  rug_blocked: 'watchtower',
  rug_alert: 'watchtower',
  launch_created: 'launchpad',
  launch_deployed: 'launchpad',
  burn: 'burn_furnace',
  governance_vote: 'agora',
  community_post: 'agora',
  supervisor_decision: 'command_center',
  intel: 'intel_hub',
  alert: 'watchtower',
  report: 'command_center',
};

// ─── ACTION DISPLAY ───────────────────────────────────────────────────────────
export const ACTION_META: Record<string, { icon: string; label: string; color: string }> = {
  lp_open:           { icon: '🌊', label: 'LP Opened',       color: '#00ff88' },
  lp_close:          { icon: '💧', label: 'LP Closed',       color: '#ff9500' },
  lp_rebalanced:     { icon: '⚖️', label: 'LP Rebalanced',   color: '#00c8ff' },
  swap:              { icon: '🔄', label: 'Swap Executed',   color: '#6366f1' },
  hl_perp_open:      { icon: '📈', label: 'Perp Opened',     color: '#00c8ff' },
  hl_perp_close:     { icon: '📉', label: 'Perp Closed',     color: '#c084fc' },
  kamino_loop:       { icon: '🔁', label: 'Kamino Loop',     color: '#ff9500' },
  signal_detected:   { icon: '⚡', label: 'Signal Detected', color: '#00c8ff' },
  rug_blocked:       { icon: '🛡️', label: 'Rug Blocked',     color: '#00ff88' },
  rug_alert:         { icon: '⚠️', label: 'Rug Alert',       color: '#ff4444' },
  launch_created:    { icon: '🛸', label: 'Launch Created',  color: '#f472b6' },
  launch_deployed:   { icon: '🚀', label: 'Token Launched',  color: '#f472b6' },
  burn:              { icon: '🔥', label: 'Tokens Burned',   color: '#ff4444' },
  governance_vote:   { icon: '🗳️', label: 'Vote Cast',       color: '#c084fc' },
  intel:             { icon: '📡', label: 'Intel Signal',    color: '#00c8ff' },
  alert:             { icon: '🛡️', label: 'Alert',           color: '#ff9500' },
  report:            { icon: '📊', label: 'Report',          color: '#00ff88' },
  supervisor_decision: { icon: '🧠', label: 'Decision Made', color: '#c084fc' },
  community_post:    { icon: '💬', label: 'Post Published',  color: '#ffd700' },
};

// ─── TILE SIZES ───────────────────────────────────────────────────────────────
export const WORLD_WIDTH  = 2400;
export const WORLD_HEIGHT = 1800;
export const TILE_SIZE    = 40;
