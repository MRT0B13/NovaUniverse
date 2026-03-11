import Phaser from 'phaser';
import { WorldScene } from './world/WorldScene';
import { HUD } from './ui/HUD';
import { EventClient } from './events/EventClient';
import { authenticate, getStoredToken, getStoredAddress, apiFetch } from './utils/auth';
import { WORLD_WIDTH, WORLD_HEIGHT } from './config/constants';

// ─── AUTH SCREEN ──────────────────────────────────────────────────────────────

const walletInput  = document.getElementById('wallet-input')  as HTMLInputElement;
const signInBtn    = document.getElementById('sign-in-btn')   as HTMLButtonElement;
const authError    = document.getElementById('auth-error')    as HTMLElement;
const authScreen   = document.getElementById('auth-screen')   as HTMLElement;

signInBtn.addEventListener('click', async () => {
  const address = walletInput.value.trim();
  if (!address) { authError.textContent = 'Enter a wallet address'; return; }

  signInBtn.textContent = 'Signing in…';
  signInBtn.disabled = true;
  authError.textContent = '';

  try {
    await authenticate(address);
    authScreen.style.display = 'none';
    startUniverse();
  } catch (e: any) {
    authError.textContent = e.message ?? 'Authentication failed';
    signInBtn.textContent = 'Enter the Universe';
    signInBtn.disabled = false;
  }
});

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
      antialias: true,
      pixelArt: false,
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

  // ── DATA POLLING LOOP ─────────────────────────────────────────────────────
  pollWorldState(worldScene, hud);
  setInterval(() => pollWorldState(worldScene, hud), 10_000);
}

// ─── WORLD STATE POLLING ──────────────────────────────────────────────────────

async function pollWorldState(scene: WorldScene, hud: HUD) {
  try {
    const [worldState, portfolio, txSummary] = await Promise.allSettled([
      apiFetch('/universe/world-state'),
      apiFetch('/portfolio'),
      apiFetch('/transactions/summary'),
    ]);

    // Sync agents
    if (worldState.status === 'fulfilled') {
      const agents: any[] = worldState.value.agents ?? [];
      scene.syncAgents(agents.map((a: any) => ({
        agentId: a.agentId ?? a.agent_id,
        status: a.status ?? 'running',
        messages24h: a.messages24h ?? a.messages_24h ?? 0,
        currentZone: a.currentZone ?? a.current_zone ?? null,
      })));
    }

    // Update HUD stats
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
    // Silently ignore — HUD retains last known values
  }
}
