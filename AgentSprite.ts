import Phaser from 'phaser';
import { AGENT_DEFS, ZONES } from '../config/constants';

interface AgentState {
  agentId: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  status: string;
  currentZone: string;
  messages24h: number;
  isAnimating: boolean;
}

export class AgentSprite {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private body: Phaser.GameObjects.Rectangle;
  private shadow: Phaser.GameObjects.Ellipse;
  private label: Phaser.GameObjects.Text;
  private statusDot: Phaser.GameObjects.Arc;
  private actionBubble: Phaser.GameObjects.Container | null = null;
  private glowFx: any;

  public state: AgentState;
  public agentId: string;

  constructor(scene: Phaser.Scene, agentId: string, x: number, y: number) {
    this.scene = scene;
    this.agentId = agentId;

    const def = AGENT_DEFS[agentId] ?? {
      label: agentId,
      emoji: '🤖',
      color: 0x888888,
      cssColor: '#888',
      role: 'Agent',
      zone: 'command_center',
    };

    this.state = {
      agentId,
      x, y,
      targetX: x,
      targetY: y,
      status: 'running',
      currentZone: def.zone,
      messages24h: 0,
      isAnimating: false,
    };

    // Shadow
    this.shadow = scene.add.ellipse(x, y + 20, 32, 12, 0x000000, 0.35);

    // Body — pixel-style character block
    this.body = scene.add.rectangle(x, y, 28, 36, def.color);
    this.body.setInteractive({ useHandCursor: true });

    // "Head" area — lighter shade
    const head = scene.add.rectangle(x, y - 10, 24, 16, def.color).setAlpha(0.7);

    // Status dot (top-right corner)
    this.statusDot = scene.add.arc(x + 12, y - 20, 5, 0, 360, false, 0x00ff88);

    // Name label
    this.label = scene.add.text(x, y + 30, def.label.replace('Nova ', '').toUpperCase(), {
      fontFamily: 'Space Mono',
      fontSize: '9px',
      color: def.cssColor,
      align: 'center',
    }).setOrigin(0.5, 0);

    // Group everything
    this.container = scene.add.container(0, 0, [
      this.shadow,
      this.body,
      head,
      this.statusDot,
      this.label,
    ]);

    // Idle bob animation
    scene.tweens.add({
      targets: [this.body, head],
      y: '-=4',
      duration: 1200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      offset: Math.random() * 1200,
    });

    // Click handler
    this.body.on('pointerdown', () => {
      scene.events.emit('agent-clicked', agentId);
    });

    this.body.on('pointerover', () => {
      scene.events.emit('agent-hover', agentId);
      this.body.setStrokeStyle(2, def.color, 1);
    });

    this.body.on('pointerout', () => {
      scene.events.emit('agent-hover-end', agentId);
      this.body.setStrokeStyle(0);
    });
  }

  /** Move agent to a zone's centre */
  walkToZone(zoneKey: string) {
    const zone = ZONES[zoneKey];
    if (!zone) return;

    // Pick a random spot within the zone (not just dead centre)
    const tx = zone.x + Phaser.Math.Between(-zone.w / 3, zone.w / 3);
    const ty = zone.y + Phaser.Math.Between(-zone.h / 3, zone.h / 3);

    this.state.targetX = tx;
    this.state.targetY = ty;
    this.state.currentZone = zoneKey;
    this.state.isAnimating = true;

    // Animate body towards target
    this.scene.tweens.add({
      targets: [this.body, this.shadow, this.label, this.statusDot],
      x: (target: any) => {
        if (target === this.shadow) return tx;
        if (target === this.label) return tx;
        if (target === this.statusDot) return tx + 12;
        return tx;
      },
      y: (target: any) => {
        if (target === this.shadow) return ty + 20;
        if (target === this.label) return ty + 30;
        if (target === this.statusDot) return ty - 20;
        return ty;
      },
      duration: 1800,
      ease: 'Power2.easeInOut',
      onComplete: () => {
        this.state.x = tx;
        this.state.y = ty;
        this.state.isAnimating = false;
      },
    });
  }

  /** Show floating action bubble above agent */
  showAction(icon: string, msg: string, color: string) {
    this.clearBubble();

    const bubble = this.scene.add.container(this.state.x, this.state.y - 50);

    const bg = this.scene.add.rectangle(0, 0, Math.min(msg.length * 7 + 32, 180), 28, 0x0a0a0a)
      .setStrokeStyle(1, parseInt(color.replace('#', '0x')));

    const text = this.scene.add.text(0, 0, `${icon} ${msg}`, {
      fontFamily: 'Space Mono',
      fontSize: '9px',
      color,
      align: 'center',
    }).setOrigin(0.5, 0.5);

    bubble.add([bg, text]);
    this.actionBubble = bubble;

    // Float up and fade out
    this.scene.tweens.add({
      targets: bubble,
      y: '-=30',
      alpha: 0,
      duration: 2800,
      ease: 'Power1.easeOut',
      onComplete: () => this.clearBubble(),
    });
  }

  private clearBubble() {
    if (this.actionBubble) {
      this.actionBubble.destroy();
      this.actionBubble = null;
    }
  }

  setStatus(status: string) {
    this.state.status = status;
    const color = status === 'running' ? 0x00ff88 : status === 'paused' ? 0xff9500 : 0xff4444;
    this.statusDot.setFillStyle(color);
  }

  flash() {
    const def = AGENT_DEFS[this.agentId];
    if (!def) return;
    this.scene.tweens.add({
      targets: this.body,
      scaleX: 1.3,
      scaleY: 1.3,
      duration: 150,
      yoyo: true,
      repeat: 1,
    });
  }

  destroy() {
    this.clearBubble();
    this.container.destroy();
    this.body.destroy();
    this.shadow.destroy();
    this.label.destroy();
    this.statusDot.destroy();
  }
}
