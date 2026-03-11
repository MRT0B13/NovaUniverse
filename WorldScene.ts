import Phaser from 'phaser';
import { ZONES, AGENT_DEFS, WORLD_WIDTH, WORLD_HEIGHT, TILE_SIZE, ACTION_ZONE_MAP } from '../config/constants';
import { AgentSprite } from '../agents/AgentSprite';
import type { UniverseEvent } from '../events/EventClient';
import type { HUD } from '../ui/HUD';

interface AgentData {
  agentId: string;
  status: string;
  messages24h: number;
  currentZone?: string;
}

export class WorldScene extends Phaser.Scene {
  private agents: Map<string, AgentSprite> = new Map();
  private hud!: HUD;
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;

  constructor() {
    super({ key: 'WorldScene' });
  }

  setHUD(hud: HUD) { this.hud = hud; }

  create() {
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.cameras.main.setBackgroundColor('#060606');

    // Centre camera
    this.cameras.main.centerOn(WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
    this.cameras.main.setZoom(0.7);

    this.drawGrid();
    this.drawZones();
    this.setupCamera();
    this.setupEventListeners();
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
      // TL
      g.moveTo(x, y + accentLen).lineTo(x, y).lineTo(x + accentLen, y);
      // TR
      g.moveTo(x + zone.w - accentLen, y).lineTo(x + zone.w, y).lineTo(x + zone.w, y + accentLen);
      // BL
      g.moveTo(x, y + zone.h - accentLen).lineTo(x, y + zone.h).lineTo(x + accentLen, y + zone.h);
      // BR
      g.moveTo(x + zone.w - accentLen, y + zone.h).lineTo(x + zone.w, y + zone.h).lineTo(x + zone.w, y + zone.h - accentLen);
      g.strokePath();

      // Zone label
      this.add.text(zone.x, y + 14, `${zone.icon}  ${zone.label.toUpperCase()}`, {
        fontFamily: 'Space Mono',
        fontSize: '10px',
        color: '#' + zone.borderColor.toString(16).padStart(6, '0'),
        align: 'center',
        alpha: 0.9,
      }).setOrigin(0.5, 0.5).setDepth(1);

      // Zone description
      this.add.text(zone.x, y + 30, zone.description, {
        fontFamily: 'Space Mono',
        fontSize: '8px',
        color: '#333333',
        align: 'center',
      }).setOrigin(0.5, 0.5).setDepth(1);

      // Invisible interactive zone rect for hover
      const zoneRect = this.add.rectangle(zone.x, zone.y, zone.w, zone.h, 0x000000, 0)
        .setInteractive()
        .setDepth(0);

      zoneRect.on('pointerover', (pointer: Phaser.Input.Pointer) => {
        const worldPt = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        this.hud?.showZoneLabel(zone.label, pointer.x, pointer.y - 30);
      });

      zoneRect.on('pointerout', () => {
        this.hud?.hideZoneLabel();
      });
    });

    g.setDepth(0);
  }

  // ── CAMERA CONTROLS ───────────────────────────────────────────────────────────

  private setupCamera() {
    const cam = this.cameras.main;

    // Drag to pan
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

    // Scroll to zoom
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

  // ── AGENT EVENTS ─────────────────────────────────────────────────────────────

  private setupEventListeners() {
    this.events.on('agent-clicked', (agentId: string) => {
      const sprite = this.agents.get(agentId);
      const def = AGENT_DEFS[agentId];
      if (!sprite || !def) return;

      this.hud?.showAgentTooltip({
        name: def.label,
        role: def.role,
        emoji: def.emoji,
        color: def.cssColor,
        status: sprite.state.status,
        messages24h: sprite.state.messages24h,
        zone: sprite.state.currentZone,
      });
    });

    this.events.on('agent-hover-end', () => {
      // Keep tooltip until another click
    });
  }

  // ── PUBLIC API ────────────────────────────────────────────────────────────────

  /** Spawn or update all agents from API data */
  syncAgents(agentList: AgentData[]) {
    const seen = new Set<string>();

    agentList.forEach(agent => {
      seen.add(agent.agentId);
      const def = AGENT_DEFS[agent.agentId];
      if (!def) return;

      if (!this.agents.has(agent.agentId)) {
        // Spawn new sprite at zone centre
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

    // Remove agents no longer in swarm
    this.agents.forEach((sprite, id) => {
      if (!seen.has(id)) {
        sprite.destroy();
        this.agents.delete(id);
      }
    });
  }

  /** React to a universe event: move agent, show bubble, flash */
  handleEvent(event: UniverseEvent) {
    const sprite = this.findAgentSprite(event.agent);
    if (!sprite) return;

    // Move to relevant zone
    const targetZone = ACTION_ZONE_MAP[event.action] ?? sprite.state.currentZone;
    if (targetZone !== sprite.state.currentZone) {
      sprite.walkToZone(targetZone);
    }

    // Show action bubble after short delay (let agent arrive first)
    this.time.delayedCall(sprite.state.isAnimating ? 1200 : 0, () => {
      sprite.showAction(event.icon, event.msg, event.color);
      sprite.flash();
    });

    // Emit tx particle if it's a financial action
    if (['lp_open', 'swap', 'hl_perp_open', 'kamino_loop'].includes(event.action)) {
      this.emitParticle(sprite.state.x, sprite.state.y, parseInt(event.color.replace('#', ''), 16));
    }
  }

  private findAgentSprite(agentName: string): AgentSprite | null {
    // Direct match
    if (this.agents.has(agentName)) return this.agents.get(agentName)!;
    // Partial match (e.g. "CFO" matches "nova-cfo")
    const lower = agentName.toLowerCase();
    for (const [id, sprite] of this.agents) {
      if (id.includes(lower) || lower.includes(id.replace('nova-', ''))) {
        return sprite;
      }
    }
    return null;
  }

  /** Small burst of particles for financial events */
  private emitParticle(x: number, y: number, color: number) {
    const g = this.add.graphics();
    g.fillStyle(color, 1);

    for (let i = 0; i < 6; i++) {
      const px = x + Phaser.Math.Between(-20, 20);
      const py = y + Phaser.Math.Between(-20, 20);
      g.fillRect(px, py, 3, 3);
    }

    this.tweens.add({
      targets: g,
      alpha: 0,
      y: '-=40',
      duration: 800,
      ease: 'Power1.easeOut',
      onComplete: () => g.destroy(),
    });
  }

  /** Pan camera to centre on a specific agent */
  focusAgent(agentId: string) {
    const sprite = this.agents.get(agentId);
    if (!sprite) return;
    this.cameras.main.pan(
      sprite.state.x,
      sprite.state.y,
      800,
      'Power2.easeInOut'
    );
  }

  /** Pan camera to a zone */
  focusZone(zoneKey: string) {
    const zone = ZONES[zoneKey];
    if (!zone) return;
    this.cameras.main.pan(zone.x, zone.y, 800, 'Power2.easeInOut');
  }

  getAgentCount() { return this.agents.size; }
}
