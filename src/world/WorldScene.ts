import Phaser from 'phaser';
import { ZONES, AGENT_DEFS, WORLD_WIDTH, WORLD_HEIGHT, TILE_SIZE, ACTION_ZONE_MAP } from '../config/constants';
import { AgentSprite } from '../agents/AgentSprite';
import { apiFetch } from '../utils/auth';
import type { UniverseEvent } from '../events/EventClient';
import type { HUD } from '../ui/HUD';

interface AgentData {
  agentId: string;
  status: string;
  messages24h: number;
  currentZone?: string;
}

// Order for number-key focus
const AGENT_ORDER = [
  'nova-cfo', 'nova-scout', 'nova-guardian', 'nova-supervisor',
  'nova-analyst', 'nova-launcher', 'nova-community',
];

export class WorldScene extends Phaser.Scene {
  private agents: Map<string, AgentSprite> = new Map();
  private hud!: HUD;
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private zoneRects: Map<string, Phaser.GameObjects.Rectangle> = new Map();

  // Particle texture key (shared)
  private particleTexKey = '__nova_px';

  // Minimap camera
  private miniCam!: Phaser.Cameras.Scene2D.Camera;
  private viewportRect!: Phaser.GameObjects.Rectangle;

  constructor() {
    super({ key: 'WorldScene' });
  }

  setHUD(hud: HUD) { this.hud = hud; }

  create() {
    // Generate agent textures first
    AgentSprite.initTextures(this);

    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.cameras.main.setBackgroundColor('#060606');
    this.cameras.main.centerOn(WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
    this.cameras.main.setZoom(0.7);

    this.createParticleTexture();
    this.drawGrid();
    this.drawZones();
    this.setupCamera();
    this.setupEventListeners();
    this.setupMinimap();
    this.setupNumberKeys();
  }

  // ── PARTICLE TEXTURE ──────────────────────────────────────────────────────

  private createParticleTexture() {
    if (this.textures.exists(this.particleTexKey)) return;
    const canvas = this.textures.createCanvas(this.particleTexKey, 6, 6)!;
    const ctx = canvas.getContext();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 6, 6);
    canvas.refresh();
  }

  // ── WORLD RENDERING ──────────────────────────────────────────────────────────

  private drawGrid() {
    const g = this.add.graphics();
    g.lineStyle(1, 0x111111, 0.4);

    for (let x = 0; x <= WORLD_WIDTH; x += TILE_SIZE) {
      g.moveTo(x, 0).lineTo(x, WORLD_HEIGHT);
    }
    for (let y = 0; y <= WORLD_HEIGHT; y += TILE_SIZE) {
      g.moveTo(0, y).lineTo(WORLD_WIDTH, y);
    }
    g.strokePath();
    g.setDepth(-10);
  }

  private drawZones() {
    const g = this.add.graphics();

    Object.entries(ZONES).forEach(([key, zone]) => {
      const x = zone.x - zone.w / 2;
      const y = zone.y - zone.h / 2;

      // Floor fill
      g.fillStyle(zone.color, 0.8);
      g.fillRect(x, y, zone.w, zone.h);

      // Border
      g.lineStyle(1.5, zone.borderColor, 0.6);
      g.strokeRect(x, y, zone.w, zone.h);

      // Corner accents
      const accentLen = 12;
      g.lineStyle(2.5, zone.borderColor, 1);
      g.moveTo(x, y + accentLen).lineTo(x, y).lineTo(x + accentLen, y);
      g.moveTo(x + zone.w - accentLen, y).lineTo(x + zone.w, y).lineTo(x + zone.w, y + accentLen);
      g.moveTo(x, y + zone.h - accentLen).lineTo(x, y + zone.h).lineTo(x + accentLen, y + zone.h);
      g.moveTo(x + zone.w - accentLen, y + zone.h).lineTo(x + zone.w, y + zone.h).lineTo(x + zone.w, y + zone.h - accentLen);
      g.strokePath();

      // Zone label
      this.add.text(zone.x, y + 14, `${zone.icon}  ${zone.label.toUpperCase()}`, {
        fontFamily: 'Space Mono',
        fontSize: '10px',
        color: '#' + zone.borderColor.toString(16).padStart(6, '0'),
        align: 'center',
        alpha: 0.9,
      } as any).setOrigin(0.5, 0.5).setDepth(1);

      // Zone description
      this.add.text(zone.x, y + 30, zone.description, {
        fontFamily: 'Space Mono',
        fontSize: '8px',
        color: '#333333',
        align: 'center',
      }).setOrigin(0.5, 0.5).setDepth(1);

      // Invisible interactive zone rect for hover + click
      const zoneRect = this.add.rectangle(zone.x, zone.y, zone.w, zone.h, 0x000000, 0)
        .setInteractive()
        .setDepth(0);

      this.zoneRects.set(key, zoneRect);

      zoneRect.on('pointerover', (_pointer: Phaser.Input.Pointer) => {
        this.hud?.showZoneLabel(zone.label, _pointer.x, _pointer.y - 30);
      });

      zoneRect.on('pointerout', () => {
        this.hud?.hideZoneLabel();
      });

      // Zone click → drill-down panel (use pointerup to avoid triggering on drag)
      zoneRect.on('pointerup', (pointer: Phaser.Input.Pointer) => {
        if (pointer.getDistance() > 8) return; // ignore drags
        this.openZonePanel(key);
      });
    });

    g.setDepth(0);
  }

  // ── ZONE DRILL-DOWN (Task 3) ─────────────────────────────────────────────

  private async openZonePanel(zoneKey: string) {
    const fetchMap: Record<string, () => Promise<any>> = {
      trading_floor: async () => {
        const [p, t] = await Promise.allSettled([
          apiFetch('/portfolio'),
          apiFetch('/transactions/summary'),
        ]);
        return {
          portfolio: p.status === 'fulfilled' ? p.value : null,
          transactions: t.status === 'fulfilled' ? t.value : null,
        };
      },
      intel_hub: () => apiFetch('/feed?limit=5').catch(() => []),
      watchtower: () => apiFetch('/health/overview').catch(() => null),
      launchpad: () => apiFetch('/launches?limit=5').catch(() => []),
      agora: () => apiFetch('/governance/proposals').catch(() => []),
      burn_furnace: () => apiFetch('/burn/stats').catch(() => null),
      command_center: () => apiFetch('/supervisor/status').catch(() => null),
      orca_pool: async () => {
        const p = await apiFetch('/portfolio').catch(() => null);
        return p;
      },
    };

    const loader = fetchMap[zoneKey];
    const data = loader ? await loader() : null;
    this.hud?.showZonePanel(zoneKey, data);
  }

  // ── CAMERA CONTROLS ───────────────────────────────────────────────────────

  private setupCamera() {
    const cam = this.cameras.main;

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.button === 0) {
        this.isDragging = true;
        this.dragStartX = p.x + cam.scrollX;
        this.dragStartY = p.y + cam.scrollY;
      }
    });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.isDragging) {
        cam.scrollX = this.dragStartX - p.x;
        cam.scrollY = this.dragStartY - p.y;
      }
    });

    this.input.on('pointerup', () => { this.isDragging = false; });

    this.input.on('wheel', (_p: any, _go: any, _dx: any, dy: number) => {
      const zoom = cam.zoom - dy * 0.001;
      cam.setZoom(Phaser.Math.Clamp(zoom, 0.3, 2.0));
    });

    // WASD keyboard pan
    const cursors = this.input.keyboard!.createCursorKeys();
    const wasd = this.input.keyboard!.addKeys('W,A,S,D') as any;

    this.events.on('update', () => {
      const speed = 6 / cam.zoom;
      if (cursors.left.isDown || wasd.A?.isDown)  cam.scrollX -= speed;
      if (cursors.right.isDown || wasd.D?.isDown) cam.scrollX += speed;
      if (cursors.up.isDown || wasd.W?.isDown)    cam.scrollY -= speed;
      if (cursors.down.isDown || wasd.S?.isDown)  cam.scrollY += speed;
    });
  }

  // ── NUMBER KEYS (Task 6) ──────────────────────────────────────────────────

  private setupNumberKeys() {
    const numKeys: string[] = ['ONE','TWO','THREE','FOUR','FIVE','SIX','SEVEN','EIGHT','NINE','ZERO'];
    const kb = this.input.keyboard!;

    numKeys.forEach((keyName, idx) => {
      kb.on(`keydown-${keyName}`, () => {
        if (idx === 9) {
          // 0 → reset to world centre
          this.cameras.main.pan(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 800, 'Power2');
          return;
        }
        const agentId = AGENT_ORDER[idx];
        if (agentId) this.focusAgent(agentId);
      });
    });
  }

  // ── MINIMAP (Task 6) ─────────────────────────────────────────────────────

  private setupMinimap() {
    const scale = 0.1;
    const mw = WORLD_WIDTH * scale;
    const mh = WORLD_HEIGHT * scale;
    const margin = 12;
    const mx = this.scale.width - mw - margin;
    const my = this.scale.height - mh - margin - 160; // above tooltip area

    // Create minimap camera
    this.miniCam = this.cameras.add(mx, my, mw, mh, false, 'minimap');
    this.miniCam.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.miniCam.setZoom(scale);
    this.miniCam.setBackgroundColor('#0a0a0a');
    this.miniCam.setAlpha(0.85);
    this.miniCam.scrollX = 0;
    this.miniCam.scrollY = 0;

    // Viewport rectangle (shows main cam view) — drawn in update
    this.viewportRect = this.add.rectangle(0, 0, 100, 100)
      .setStrokeStyle(3, 0xffffff, 0.8)
      .setFillStyle(0xffffff, 0.05)
      .setDepth(50);

    // Hide viewport rect from main camera (only visible on minimap)
    this.cameras.main.ignore(this.viewportRect);

    // Minimap border (DOM overlay)
    const border = document.createElement('div');
    border.id = 'minimap-border';
    border.style.cssText = `
      position:absolute;
      right:${margin}px;
      bottom:${margin + 160}px;
      width:${mw}px;
      height:${mh}px;
      border:1px solid #1a1a1a;
      border-radius:4px;
      pointer-events:all;
      z-index:9;
      cursor:crosshair;
    `;
    document.getElementById('hud')!.appendChild(border);

    // Click minimap → pan main camera
    border.addEventListener('click', (e) => {
      const rect = border.getBoundingClientRect();
      const rx = (e.clientX - rect.left) / mw;
      const ry = (e.clientY - rect.top) / mh;
      const wx = rx * WORLD_WIDTH;
      const wy = ry * WORLD_HEIGHT;
      this.cameras.main.pan(wx, wy, 600, 'Power2');
    });

    // Update viewport rect position each frame
    this.events.on('update', () => {
      const cam = this.cameras.main;
      const cx = cam.scrollX + cam.width / (2 * cam.zoom);
      const cy = cam.scrollY + cam.height / (2 * cam.zoom);
      const vw = cam.width / cam.zoom;
      const vh = cam.height / cam.zoom;
      this.viewportRect.setPosition(cx, cy);
      this.viewportRect.setSize(vw, vh);
    });

    // Reposition minimap camera on window resize
    this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      const newMx = gameSize.width - mw - margin;
      const newMy = gameSize.height - mh - margin - 160;
      this.miniCam.setPosition(newMx, newMy);
      // Also reposition the DOM border
      const borderEl = document.getElementById('minimap-border');
      if (borderEl) {
        borderEl.style.right = `${margin}px`;
        borderEl.style.bottom = `${margin + 160}px`;
      }
    });
  }

  // ── AGENT EVENTS ─────────────────────────────────────────────────────────────

  private setupEventListeners() {
    this.events.on('agent-clicked', async (agentId: string) => {
      const sprite = this.agents.get(agentId);
      const def = AGENT_DEFS[agentId];
      if (!sprite || !def) return;

      // Fetch recent feed and filter for this agent (Task 4)
      let messages: string[] = [];
      try {
        const feed: any[] = await apiFetch('/feed?limit=20');
        messages = (Array.isArray(feed) ? feed : [])
          .filter((item: any) => {
            const agent = item.agent ?? item.from_agent ?? '';
            return agent.toLowerCase().includes(agentId.replace('nova-', ''));
          })
          .slice(0, 5)
          .map((item: any) => item.msg ?? item.summary ?? item.action ?? '...');
      } catch { /* ignore — show tooltip without messages */ }

      this.hud?.showAgentTooltip({
        name: def.label,
        role: def.role,
        emoji: def.emoji,
        color: def.cssColor,
        status: sprite.state.status,
        messages24h: sprite.state.messages24h,
        zone: sprite.state.currentZone,
      }, messages);
    });

    this.events.on('agent-hover-end', () => {
      // Keep tooltip until another click
    });
  }

  // ── PUBLIC API ────────────────────────────────────────────────────────────────

  syncAgents(agentList: AgentData[]) {
    const seen = new Set<string>();

    agentList.forEach(agent => {
      seen.add(agent.agentId);
      const def = AGENT_DEFS[agent.agentId];
      if (!def) return;

      if (!this.agents.has(agent.agentId)) {
        const zone = ZONES[def.zone];
        const x = zone ? zone.x + Phaser.Math.Between(-80, 80) : WORLD_WIDTH / 2;
        const y = zone ? zone.y + Phaser.Math.Between(-60, 60) : WORLD_HEIGHT / 2;
        const sprite = new AgentSprite(this, agent.agentId, x, y);
        this.agents.set(agent.agentId, sprite);
      }

      const sprite = this.agents.get(agent.agentId)!;
      sprite.setStatus(agent.status);
      sprite.state.messages24h = agent.messages24h;

      if (agent.currentZone && agent.currentZone !== sprite.state.currentZone) {
        sprite.walkToZone(agent.currentZone);
      }
    });

    this.agents.forEach((sprite, id) => {
      if (!seen.has(id)) {
        sprite.destroy();
        this.agents.delete(id);
      }
    });
  }

  /** React to a universe event: move agent, show bubble, flash, particles */
  handleEvent(event: UniverseEvent) {
    const sprite = this.findAgentSprite(event.agent);
    if (!sprite) return;

    const targetZone = ACTION_ZONE_MAP[event.action] ?? sprite.state.currentZone;
    if (targetZone !== sprite.state.currentZone) {
      sprite.walkToZone(targetZone);
    }

    this.time.delayedCall(sprite.state.isAnimating ? 1200 : 0, () => {
      sprite.showAction(event.icon, event.msg, event.color);
      sprite.flash();
    });

    // Particle effects (Task 2)
    const isFinancial = ['lp_open', 'swap', 'hl_perp_open', 'kamino_loop', 'lp_rebalanced'].includes(event.action);
    const isRug = ['rug_blocked', 'rug_alert'].includes(event.action);

    if (isFinancial) {
      this.emitFinancialParticles(sprite, targetZone, parseInt(event.color.replace('#', ''), 16));
    } else if (isRug) {
      this.emitRugParticles(sprite);
    }
  }

  /** Replay a historical event (Task 5) — trigger animation without HUD push */
  replayEvent(event: UniverseEvent) {
    const sprite = this.findAgentSprite(event.agent);
    if (!sprite) return;

    const targetZone = ACTION_ZONE_MAP[event.action] ?? sprite.state.currentZone;
    if (targetZone !== sprite.state.currentZone) {
      sprite.walkToZone(targetZone);
    }

    this.time.delayedCall(sprite.state.isAnimating ? 1200 : 0, () => {
      sprite.showAction(event.icon, event.msg, event.color);
      sprite.flash();
    });
  }

  private findAgentSprite(agentName: string): AgentSprite | null {
    if (this.agents.has(agentName)) return this.agents.get(agentName)!;
    const lower = agentName.toLowerCase();
    for (const [id, sprite] of this.agents) {
      if (id.includes(lower) || lower.includes(id.replace('nova-', ''))) {
        return sprite;
      }
    }
    return null;
  }

  // ── PARTICLE EFFECTS (Task 2) ────────────────────────────────────────────

  /** Financial event: coin particles burst from agent toward target zone */
  private emitFinancialParticles(sprite: AgentSprite, zoneKey: string, color: number) {
    const zone = ZONES[zoneKey];
    if (!zone) return;

    const pos = sprite.getPosition();

    // Calculate angle toward zone centre
    const angle = Phaser.Math.Angle.Between(pos.x, pos.y, zone.x, zone.y);
    const angleDeg = Phaser.Math.RadToDeg(angle);

    const emitter = this.add.particles(pos.x, pos.y, this.particleTexKey, {
      speed: { min: 80, max: 200 },
      angle: { min: angleDeg - 25, max: angleDeg + 25 },
      scale: { start: 0.8, end: 0.1 },
      alpha: { start: 1, end: 0 },
      lifespan: 1200,
      tint: color,
      quantity: 12,
      emitting: false,
    });
    emitter.setDepth(15);
    emitter.explode(12);

    this.time.delayedCall(1500, () => emitter.destroy());
  }

  /** Rug blocked: red burst + green shield pulse */
  private emitRugParticles(sprite: AgentSprite) {
    const pos = sprite.getPosition();

    // Red burst outward
    const red = this.add.particles(pos.x, pos.y, this.particleTexKey, {
      speed: { min: 100, max: 250 },
      angle: { min: 0, max: 360 },
      scale: { start: 1, end: 0.2 },
      alpha: { start: 1, end: 0 },
      lifespan: 800,
      tint: 0xff4444,
      quantity: 16,
      emitting: false,
    });
    red.setDepth(15);
    red.explode(16);

    // Green shield pulse
    const shield = this.add.circle(pos.x, pos.y, 8, 0x00ff88, 0.6).setDepth(14);
    this.tweens.add({
      targets: shield,
      scaleX: 5,
      scaleY: 5,
      alpha: 0,
      duration: 900,
      ease: 'Power2.easeOut',
      onComplete: () => shield.destroy(),
    });

    this.time.delayedCall(1200, () => red.destroy());
  }

  /** Pan camera to centre on a specific agent */
  focusAgent(agentId: string) {
    const sprite = this.agents.get(agentId);
    if (!sprite) return;
    const pos = sprite.getPosition();
    this.cameras.main.pan(pos.x, pos.y, 800, 'Power2');
  }

  focusZone(zoneKey: string) {
    const zone = ZONES[zoneKey];
    if (!zone) return;
    this.cameras.main.pan(zone.x, zone.y, 800, 'Power2');
  }

  getAgentCount() { return this.agents.size; }
}
