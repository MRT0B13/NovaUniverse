import { World3D } from './world/World3D';
import { HUD } from './ui/HUD';
import { EventClient } from './events/EventClient';
import { authenticate, getStoredToken, getStoredAddress, apiFetch } from './utils/auth';
import { ACTION_ZONE_MAP, ACTION_META, AGENT_DEFS } from './config/constants';

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

async function startUniverse() {
  const hud = new HUD();
  hud.show();

  // ── Three.js canvas boot ────────────────────────────────────────────────
  const canvas = document.getElementById('world-canvas') as HTMLCanvasElement;
  const world = new World3D(canvas);
  world.setHUD(hud);

  // ── Loading bar during asset load ─────────────────────────────────────────
  hud.showLoadingBar('Loading 3D assets…');
  await world.loadAssets(pct => hud.updateLoadingProgress(pct));
  hud.hideLoadingBar();

  // ── Render loop ───────────────────────────────────────────────────────────
  function animate() {
    requestAnimationFrame(animate);
    world.tick();
  }
  animate();

  // ── EVENT CLIENT (WS + polling fallback) ──────────────────────────────────
  const eventClient = new EventClient();
  eventClient.onEvent(event => {
    world.handleEvent(event);
    hud.pushEvent(event);
  });
  eventClient.connect();

  // ── TIMELINE REPLAY HANDLER ───────────────────────────────────────────────
  hud.setReplayHandler(event => {
    world.replayEvent(event);
  });

  // Load initial timeline events
  loadTimeline(hud);

  // ── DATA POLLING LOOP ─────────────────────────────────────────────────────
  pollWorldState(world, hud);
  setInterval(() => pollWorldState(world, hud), 10_000);
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

async function pollWorldState(world: World3D, hud: HUD) {
  try {
    const [worldState, portfolio, txSummary] = await Promise.allSettled([
      apiFetch('/universe/world-state'),
      apiFetch('/portfolio'),
      apiFetch('/transactions/summary'),
    ]);

    if (worldState.status === 'fulfilled') {
      let agents: any[] = worldState.value.agents ?? [];

      // Fallback: if no agents from API, spawn all known agents in preview mode
      if (agents.length === 0) {
        agents = Object.keys(AGENT_DEFS).map(agentId => ({
          agentId,
          status: 'running',
          messages24h: 0,
          currentZone: null,
        }));
      }

      world.syncAgents(agents.map((a: any) => ({
        agentId: a.agentId ?? a.agent_id,
        status: a.status ?? 'running',
        messages24h: a.messages24h ?? a.messages_24h ?? 0,
        currentZone: a.currentZone ?? a.current_zone ?? null,
      })));
    }

    const pf  = portfolio.status === 'fulfilled' ? portfolio.value : null;
    const txs = txSummary.status === 'fulfilled' ? txSummary.value : null;

    const novaVal = typeof pf?.nova === 'object'
      ? pf.nova.balance ?? 0
      : pf?.nova ?? pf?.nova_balance ?? 0;

    hud.updateStats({
      portfolio: pf?.summary?.total_value_usd ?? pf?.totalValue ?? pf?.total_value ?? 0,
      agents: world.getAgentCount(),
      txs: txs?.today ?? txs?.count_today ?? 0,
      nova: novaVal,
      address: getStoredAddress() ?? '',
    });
  } catch {
    // Silently ignore
  }
}
