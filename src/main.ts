import Phaser from 'phaser';
import { WorldScene } from './world/WorldScene';
import { HUD } from './ui/HUD';
import { EventClient } from './events/EventClient';
import { authenticate, getStoredToken, getStoredAddress, apiFetch } from './utils/auth';
import { WORLD_WIDTH, WORLD_HEIGHT, ACTION_ZONE_MAP, ACTION_META } from './config/constants';

// ─── AUTH SCREEN ──────────────────────────────────────────────────────────────

const evmBtn     = document.getElementById('evm-connect-btn') as HTMLButtonElement;
const solBtn     = document.getElementById('sol-connect-btn') as HTMLButtonElement;
const authError  = document.getElementById('auth-error')      as HTMLElement;
const authScreen = document.getElementById('auth-screen')     as HTMLElement;

// ── EVM Wallet (MetaMask, Rabby, etc.) ──────────────────────────────────────
evmBtn.addEventListener('click', async () => {
  const eth = (window as any).ethereum;
  if (!eth) {
    authError.textContent = 'No EVM wallet detected. Install MetaMask.';
    return;
  }
  try {
    setBothDisabled(true, '🦊 Connecting…', solBtn.textContent!);
    const accounts: string[] = await eth.request({ method: 'eth_requestAccounts' });
    if (accounts.length === 0) throw new Error('No accounts returned');
    await doAuth(accounts[0], 'evm');
  } catch (e: any) {
    authError.textContent = e.message ?? 'EVM wallet connection failed';
    resetButtons();
  }
});

// ── Solana Wallet (Phantom, Solflare, etc.) ─────────────────────────────────
solBtn.addEventListener('click', async () => {
  const sol = (window as any).phantom?.solana ?? (window as any).solana;
  if (!sol) {
    authError.textContent = 'No Solana wallet detected. Install Phantom.';
    return;
  }
  try {
    setBothDisabled(true, evmBtn.textContent!, '👻 Connecting…');
    const resp = await sol.connect();
    const address = resp.publicKey.toString();
    await doAuth(address, 'solana');
  } catch (e: any) {
    authError.textContent = e.message ?? 'Solana wallet connection failed';
    resetButtons();
  }
});

function setBothDisabled(disabled: boolean, evmText: string, solText: string) {
  evmBtn.disabled = disabled;
  solBtn.disabled = disabled;
  evmBtn.textContent = evmText;
  solBtn.textContent = solText;
  authError.textContent = '';
}

function resetButtons() {
  evmBtn.textContent = '🦊 Connect EVM Wallet';
  solBtn.textContent = '👻 Connect Solana Wallet';
  evmBtn.disabled = false;
  solBtn.disabled = false;
}

async function doAuth(address: string, walletType: 'evm' | 'solana') {
  try {
    await authenticate(address, walletType);
    authScreen.style.display = 'none';
    startUniverse();
  } catch (e: any) {
    authError.textContent = e.message ?? 'Authentication failed';
    resetButtons();
  }
}

// If already authenticated from this session, skip auth screen
if (getStoredToken() && getStoredAddress()) {
  authScreen.style.display = 'none';
  startUniverse();
}

// ─── UNIVERSE BOOTSTRAP ───────────────────────────────────────────────────────

function startUniverse() {
  const hud = new HUD();
  hud.show();

  const worldScene = new WorldScene();
  worldScene.setHUD(hud);

  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: '#060606',
    parent: 'game-container',
    scene: worldScene,
    physics: { default: 'arcade', arcade: { debug: false } },
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    render: {
      antialias: false,
      pixelArt: true,
    },
  };

  const game = new Phaser.Game(config);

  // ── EVENT CLIENT (WS + polling fallback) ──────────────────────────────────
  const eventClient = new EventClient();
  eventClient.onEvent(event => {
    worldScene.handleEvent(event);
    hud.pushEvent(event);
  });
  eventClient.connect();

  // ── TIMELINE REPLAY HANDLER (Task 5) ──────────────────────────────────────
  hud.setReplayHandler((event) => {
    worldScene.replayEvent(event);
  });

  // Load initial timeline events
  loadTimeline(hud);

  // ── DATA POLLING LOOP ─────────────────────────────────────────────────────
  pollWorldState(worldScene, hud);
  setInterval(() => pollWorldState(worldScene, hud), 10_000);
}

// ─── TIMELINE LOAD ────────────────────────────────────────────────────────────

async function loadTimeline(hud: HUD) {
  try {
    const raw: any[] = await apiFetch('/universe/events?limit=50');
    const events = (Array.isArray(raw) ? raw : []).map((r: any) => {
      const action = r.action ?? r.type ?? 'intel';
      const meta = ACTION_META[action] ?? { icon: '🤖', label: action, color: '#888' };
      return {
        id: r.id ?? String(Date.now()),
        agent: r.agent ?? 'unknown',
        action,
        zone: ACTION_ZONE_MAP[action] ?? 'command_center',
        msg: r.msg ?? r.summary ?? meta.label,
        icon: r.icon ?? meta.icon,
        color: r.color ?? meta.color,
        ts: r.ts ?? Date.now(),
      };
    });
    hud.loadTimelineEvents(events);
  } catch { /* ignore — timeline stays empty */ }
}

// ─── WORLD STATE POLLING ──────────────────────────────────────────────────────

async function pollWorldState(scene: WorldScene, hud: HUD) {
  try {
    const [worldState, portfolio, txSummary] = await Promise.allSettled([
      apiFetch('/universe/world-state'),
      apiFetch('/portfolio'),
      apiFetch('/transactions/summary'),
    ]);

    if (worldState.status === 'fulfilled') {
      const agents: any[] = worldState.value.agents ?? [];
      scene.syncAgents(agents.map((a: any) => ({
        agentId: a.agentId ?? a.agent_id,
        status: a.status ?? 'running',
        messages24h: a.messages24h ?? a.messages_24h ?? 0,
        currentZone: a.currentZone ?? a.current_zone ?? null,
      })));
    }

    const pf  = portfolio.status === 'fulfilled' ? portfolio.value : null;
    const txs = txSummary.status === 'fulfilled' ? txSummary.value : null;

    hud.updateStats({
      portfolio: pf?.totalValue ?? pf?.total_value ?? 0,
      agents: scene.getAgentCount(),
      txs: txs?.today ?? txs?.count_today ?? 0,
      nova: pf?.nova ?? pf?.nova_balance ?? 0,
      address: getStoredAddress() ?? '',
    });
  } catch {
    // Silently ignore
  }
}
