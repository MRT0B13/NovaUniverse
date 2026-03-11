import Phaser from 'phaser';
import { AGENT_DEFS, ZONES } from '../config/constants';

// ─── PIXEL ART DEFINITIONS (8×12 grids) ────────────────────────────────────
// 0 = transparent, 1 = body colour, 2 = darker shade, 3 = lighter (highlight)
type PixelGrid = number[][];

const SPRITE_W = 8;
const SPRITE_H = 12;
const PIXEL_SCALE = 3; // each pixel → 3×3 on canvas

const SILHOUETTES: Record<string, PixelGrid[]> = {
  // nova-cfo: suit + briefcase — 4 frames (idle, walk1, idle, walk2)
  'nova-cfo': [
    // frame 0 (idle / stand)
    [
      [0,0,1,1,1,1,0,0],
      [0,0,1,3,3,1,0,0],
      [0,0,1,1,1,1,0,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,3,3,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,0,1,2,2,1,0,0],
      [0,0,1,0,0,1,0,0],
      [0,0,1,0,0,1,0,0],
      [0,1,1,0,0,1,1,0],
      [0,0,0,0,0,0,0,2],
    ],
    // frame 1 (walk left leg forward)
    [
      [0,0,1,1,1,1,0,0],
      [0,0,1,3,3,1,0,0],
      [0,0,1,1,1,1,0,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,3,3,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,0,1,2,2,1,0,0],
      [0,1,1,0,0,1,0,0],
      [0,0,0,1,0,0,1,0],
      [0,0,1,1,0,1,1,0],
      [0,0,0,0,0,0,0,2],
    ],
    // frame 2 (idle again)
    [
      [0,0,1,1,1,1,0,0],
      [0,0,1,3,3,1,0,0],
      [0,0,1,1,1,1,0,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,3,3,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,0,1,2,2,1,0,0],
      [0,0,1,0,0,1,0,0],
      [0,0,1,0,0,1,0,0],
      [0,1,1,0,0,1,1,0],
      [0,0,0,0,0,0,0,2],
    ],
    // frame 3 (walk right leg forward)
    [
      [0,0,1,1,1,1,0,0],
      [0,0,1,3,3,1,0,0],
      [0,0,1,1,1,1,0,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,3,3,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,0,1,2,2,1,0,0],
      [0,0,1,0,1,1,0,0],
      [0,1,0,0,0,0,1,0],
      [0,1,1,0,0,1,1,0],
      [0,0,0,0,0,0,0,2],
    ],
  ],

  // nova-scout: antenna on head
  'nova-scout': [
    [
      [0,0,0,1,0,0,0,0],
      [0,0,1,1,1,1,0,0],
      [0,0,1,3,3,1,0,0],
      [0,0,1,1,1,1,0,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,0,1,2,2,1,0,0],
      [0,0,1,0,0,1,0,0],
      [0,0,1,0,0,1,0,0],
      [0,1,1,0,0,1,1,0],
      [0,0,0,0,0,0,0,0],
    ],
    [
      [0,0,0,1,0,0,0,0],
      [0,0,1,1,1,1,0,0],
      [0,0,1,3,3,1,0,0],
      [0,0,1,1,1,1,0,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,0,1,2,2,1,0,0],
      [0,1,1,0,0,1,0,0],
      [0,0,0,1,0,0,1,0],
      [0,0,1,1,0,1,1,0],
      [0,0,0,0,0,0,0,0],
    ],
    [
      [0,0,0,1,0,0,0,0],
      [0,0,1,1,1,1,0,0],
      [0,0,1,3,3,1,0,0],
      [0,0,1,1,1,1,0,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,0,1,2,2,1,0,0],
      [0,0,1,0,0,1,0,0],
      [0,0,1,0,0,1,0,0],
      [0,1,1,0,0,1,1,0],
      [0,0,0,0,0,0,0,0],
    ],
    [
      [0,0,0,1,0,0,0,0],
      [0,0,1,1,1,1,0,0],
      [0,0,1,3,3,1,0,0],
      [0,0,1,1,1,1,0,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,0,1,2,2,1,0,0],
      [0,0,1,0,1,1,0,0],
      [0,1,0,0,0,0,1,0],
      [0,1,1,0,0,1,1,0],
      [0,0,0,0,0,0,0,0],
    ],
  ],

  // nova-guardian: shield armour shape
  'nova-guardian': [
    [
      [0,0,1,1,1,1,0,0],
      [0,0,1,3,3,1,0,0],
      [0,0,1,1,1,1,0,0],
      [0,1,2,2,2,2,1,0],
      [1,2,2,3,3,2,2,1],
      [1,2,2,2,2,2,2,1],
      [0,1,2,2,2,2,1,0],
      [0,0,1,2,2,1,0,0],
      [0,0,1,0,0,1,0,0],
      [0,0,1,0,0,1,0,0],
      [0,1,1,0,0,1,1,0],
      [0,0,0,0,0,0,0,0],
    ],
    [
      [0,0,1,1,1,1,0,0],
      [0,0,1,3,3,1,0,0],
      [0,0,1,1,1,1,0,0],
      [0,1,2,2,2,2,1,0],
      [1,2,2,3,3,2,2,1],
      [1,2,2,2,2,2,2,1],
      [0,1,2,2,2,2,1,0],
      [0,0,1,2,2,1,0,0],
      [0,1,1,0,0,1,0,0],
      [0,0,0,1,0,0,1,0],
      [0,0,1,1,0,1,1,0],
      [0,0,0,0,0,0,0,0],
    ],
    [
      [0,0,1,1,1,1,0,0],
      [0,0,1,3,3,1,0,0],
      [0,0,1,1,1,1,0,0],
      [0,1,2,2,2,2,1,0],
      [1,2,2,3,3,2,2,1],
      [1,2,2,2,2,2,2,1],
      [0,1,2,2,2,2,1,0],
      [0,0,1,2,2,1,0,0],
      [0,0,1,0,0,1,0,0],
      [0,0,1,0,0,1,0,0],
      [0,1,1,0,0,1,1,0],
      [0,0,0,0,0,0,0,0],
    ],
    [
      [0,0,1,1,1,1,0,0],
      [0,0,1,3,3,1,0,0],
      [0,0,1,1,1,1,0,0],
      [0,1,2,2,2,2,1,0],
      [1,2,2,3,3,2,2,1],
      [1,2,2,2,2,2,2,1],
      [0,1,2,2,2,2,1,0],
      [0,0,1,2,2,1,0,0],
      [0,0,1,0,1,1,0,0],
      [0,1,0,0,0,0,1,0],
      [0,1,1,0,0,1,1,0],
      [0,0,0,0,0,0,0,0],
    ],
  ],

  // nova-supervisor: big head / brain shape
  'nova-supervisor': [
    [
      [0,1,1,1,1,1,1,0],
      [1,3,3,3,3,3,3,1],
      [0,1,1,1,1,1,1,0],
      [0,0,1,1,1,1,0,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,0,1,2,2,1,0,0],
      [0,0,1,0,0,1,0,0],
      [0,0,1,0,0,1,0,0],
      [0,1,1,0,0,1,1,0],
      [0,0,0,0,0,0,0,0],
    ],
    [
      [0,1,1,1,1,1,1,0],
      [1,3,3,3,3,3,3,1],
      [0,1,1,1,1,1,1,0],
      [0,0,1,1,1,1,0,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,0,1,2,2,1,0,0],
      [0,1,1,0,0,1,0,0],
      [0,0,0,1,0,0,1,0],
      [0,0,1,1,0,1,1,0],
      [0,0,0,0,0,0,0,0],
    ],
    [
      [0,1,1,1,1,1,1,0],
      [1,3,3,3,3,3,3,1],
      [0,1,1,1,1,1,1,0],
      [0,0,1,1,1,1,0,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,0,1,2,2,1,0,0],
      [0,0,1,0,0,1,0,0],
      [0,0,1,0,0,1,0,0],
      [0,1,1,0,0,1,1,0],
      [0,0,0,0,0,0,0,0],
    ],
    [
      [0,1,1,1,1,1,1,0],
      [1,3,3,3,3,3,3,1],
      [0,1,1,1,1,1,1,0],
      [0,0,1,1,1,1,0,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,0,1,2,2,1,0,0],
      [0,0,1,0,1,1,0,0],
      [0,1,0,0,0,0,1,0],
      [0,1,1,0,0,1,1,0],
      [0,0,0,0,0,0,0,0],
    ],
  ],

  // nova-analyst: glasses + chart
  'nova-analyst': [
    [
      [0,0,1,1,1,1,0,0],
      [0,1,3,1,1,3,1,0],
      [0,0,1,1,1,1,0,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,0,1,2,2,1,0,0],
      [0,0,1,0,0,1,0,0],
      [0,0,1,0,0,1,0,0],
      [0,1,1,0,0,1,1,0],
      [0,0,0,0,0,0,0,0],
    ],
    [
      [0,0,1,1,1,1,0,0],
      [0,1,3,1,1,3,1,0],
      [0,0,1,1,1,1,0,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,0,1,2,2,1,0,0],
      [0,1,1,0,0,1,0,0],
      [0,0,0,1,0,0,1,0],
      [0,0,1,1,0,1,1,0],
      [0,0,0,0,0,0,0,0],
    ],
    [
      [0,0,1,1,1,1,0,0],
      [0,1,3,1,1,3,1,0],
      [0,0,1,1,1,1,0,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,0,1,2,2,1,0,0],
      [0,0,1,0,0,1,0,0],
      [0,0,1,0,0,1,0,0],
      [0,1,1,0,0,1,1,0],
      [0,0,0,0,0,0,0,0],
    ],
    [
      [0,0,1,1,1,1,0,0],
      [0,1,3,1,1,3,1,0],
      [0,0,1,1,1,1,0,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,0,1,2,2,1,0,0],
      [0,0,1,0,1,1,0,0],
      [0,1,0,0,0,0,1,0],
      [0,1,1,0,0,1,1,0],
      [0,0,0,0,0,0,0,0],
    ],
  ],

  // nova-launcher: rocket on back
  'nova-launcher': [
    [
      [0,0,1,1,1,1,0,0],
      [0,0,1,3,3,1,0,0],
      [0,0,1,1,1,1,0,0],
      [0,1,2,2,2,2,1,2],
      [0,1,2,2,2,2,1,3],
      [0,1,2,2,2,2,1,2],
      [0,1,2,2,2,2,1,0],
      [0,0,1,2,2,1,0,0],
      [0,0,1,0,0,1,0,0],
      [0,0,1,0,0,1,0,0],
      [0,1,1,0,0,1,1,0],
      [0,0,0,0,0,0,0,0],
    ],
    [
      [0,0,1,1,1,1,0,0],
      [0,0,1,3,3,1,0,0],
      [0,0,1,1,1,1,0,0],
      [0,1,2,2,2,2,1,2],
      [0,1,2,2,2,2,1,3],
      [0,1,2,2,2,2,1,2],
      [0,1,2,2,2,2,1,0],
      [0,0,1,2,2,1,0,0],
      [0,1,1,0,0,1,0,0],
      [0,0,0,1,0,0,1,0],
      [0,0,1,1,0,1,1,0],
      [0,0,0,0,0,0,0,0],
    ],
    [
      [0,0,1,1,1,1,0,0],
      [0,0,1,3,3,1,0,0],
      [0,0,1,1,1,1,0,0],
      [0,1,2,2,2,2,1,2],
      [0,1,2,2,2,2,1,3],
      [0,1,2,2,2,2,1,2],
      [0,1,2,2,2,2,1,0],
      [0,0,1,2,2,1,0,0],
      [0,0,1,0,0,1,0,0],
      [0,0,1,0,0,1,0,0],
      [0,1,1,0,0,1,1,0],
      [0,0,0,0,0,0,0,0],
    ],
    [
      [0,0,1,1,1,1,0,0],
      [0,0,1,3,3,1,0,0],
      [0,0,1,1,1,1,0,0],
      [0,1,2,2,2,2,1,2],
      [0,1,2,2,2,2,1,3],
      [0,1,2,2,2,2,1,2],
      [0,1,2,2,2,2,1,0],
      [0,0,1,2,2,1,0,0],
      [0,0,1,0,1,1,0,0],
      [0,1,0,0,0,0,1,0],
      [0,1,1,0,0,1,1,0],
      [0,0,0,0,0,0,0,0],
    ],
  ],

  // nova-community: speech bubble halo
  'nova-community': [
    [
      [0,1,1,1,1,1,0,0],
      [0,1,3,3,3,1,0,0],
      [0,0,1,0,1,0,0,0],
      [0,0,1,1,1,1,0,0],
      [0,0,1,3,3,1,0,0],
      [0,0,1,1,1,1,0,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,0,1,0,0,1,0,0],
      [0,0,1,0,0,1,0,0],
      [0,1,1,0,0,1,1,0],
      [0,0,0,0,0,0,0,0],
    ],
    [
      [0,1,1,1,1,1,0,0],
      [0,1,3,3,3,1,0,0],
      [0,0,1,0,1,0,0,0],
      [0,0,1,1,1,1,0,0],
      [0,0,1,3,3,1,0,0],
      [0,0,1,1,1,1,0,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,1,1,0,0,1,0,0],
      [0,0,0,1,0,0,1,0],
      [0,0,1,1,0,1,1,0],
      [0,0,0,0,0,0,0,0],
    ],
    [
      [0,1,1,1,1,1,0,0],
      [0,1,3,3,3,1,0,0],
      [0,0,1,0,1,0,0,0],
      [0,0,1,1,1,1,0,0],
      [0,0,1,3,3,1,0,0],
      [0,0,1,1,1,1,0,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,0,1,0,0,1,0,0],
      [0,0,1,0,0,1,0,0],
      [0,1,1,0,0,1,1,0],
      [0,0,0,0,0,0,0,0],
    ],
    [
      [0,1,1,1,1,1,0,0],
      [0,1,3,3,3,1,0,0],
      [0,0,1,0,1,0,0,0],
      [0,0,1,1,1,1,0,0],
      [0,0,1,3,3,1,0,0],
      [0,0,1,1,1,1,0,0],
      [0,1,2,2,2,2,1,0],
      [0,1,2,2,2,2,1,0],
      [0,0,1,0,1,1,0,0],
      [0,1,0,0,0,0,1,0],
      [0,1,1,0,0,1,1,0],
      [0,0,0,0,0,0,0,0],
    ],
  ],
};

// ─── TEXTURE GENERATION ────────────────────────────────────────────────────────

function hexToRgb(hex: number): { r: number; g: number; b: number } {
  return { r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff };
}

function generateAgentTextures(scene: Phaser.Scene) {
  const agents = Object.keys(AGENT_DEFS);
  for (const agentId of agents) {
    const def = AGENT_DEFS[agentId];
    const frames = SILHOUETTES[agentId] ?? SILHOUETTES['nova-cfo']; // fallback
    const texKey = `agent_${agentId}`;

    if (scene.textures.exists(texKey)) continue;

    const frameW = SPRITE_W * PIXEL_SCALE;
    const frameH = SPRITE_H * PIXEL_SCALE;
    const totalW = frameW * 4; // 4 frames side by side

    const canvas = scene.textures.createCanvas(texKey, totalW, frameH)!;
    const ctx = canvas.getContext();
    const base = hexToRgb(def.color);

    for (let f = 0; f < 4; f++) {
      const grid = frames[f] ?? frames[0];
      const ox = f * frameW;

      for (let row = 0; row < SPRITE_H; row++) {
        for (let col = 0; col < SPRITE_W; col++) {
          const v = grid[row]?.[col] ?? 0;
          if (v === 0) continue;

          let r = base.r, g = base.g, b = base.b;
          if (v === 2) { r = Math.floor(r * 0.55); g = Math.floor(g * 0.55); b = Math.floor(b * 0.55); }
          if (v === 3) { r = Math.min(255, r + 80); g = Math.min(255, g + 80); b = Math.min(255, b + 80); }

          ctx.fillStyle = `rgb(${r},${g},${b})`;
          ctx.fillRect(ox + col * PIXEL_SCALE, row * PIXEL_SCALE, PIXEL_SCALE, PIXEL_SCALE);
        }
      }
    }

    canvas.refresh();

    // Register as sprite sheet
    const tex = scene.textures.get(texKey);
    tex.add(0, 0, 0, 0, frameW, frameH);
    tex.add(1, 0, frameW, 0, frameW, frameH);
    tex.add(2, 0, frameW * 2, 0, frameW, frameH);
    tex.add(3, 0, frameW * 3, 0, frameW, frameH);

    // Create animation
    scene.anims.create({
      key: `${texKey}_walk`,
      frames: [
        { key: texKey, frame: 0 },
        { key: texKey, frame: 1 },
        { key: texKey, frame: 2 },
        { key: texKey, frame: 3 },
      ],
      frameRate: 8,
      repeat: -1,
    });

    scene.anims.create({
      key: `${texKey}_idle`,
      frames: [{ key: texKey, frame: 0 }],
      frameRate: 1,
      repeat: -1,
    });
  }
}

// ─── AGENT STATE ───────────────────────────────────────────────────────────────

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

// ─── SPRITE CLASS ──────────────────────────────────────────────────────────────

export class AgentSprite {
  private scene: Phaser.Scene;
  private sprite: Phaser.GameObjects.Sprite;
  private shadow: Phaser.GameObjects.Ellipse;
  private label: Phaser.GameObjects.Text;
  private statusDot: Phaser.GameObjects.Arc;
  private actionBubble: Phaser.GameObjects.Container | null = null;
  private walkTween: Phaser.Tweens.Tween | null = null;

  public state: AgentState;
  public agentId: string;

  /** Must be called once before any AgentSprite is constructed */
  static initTextures(scene: Phaser.Scene) {
    generateAgentTextures(scene);
  }

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

    const texKey = `agent_${agentId}`;

    // Shadow
    this.shadow = scene.add.ellipse(x, y + 20, 32, 12, 0x000000, 0.35).setDepth(4);

    // Sprite
    this.sprite = scene.add.sprite(x, y, texKey, 0).setDepth(5);
    this.sprite.setInteractive({ useHandCursor: true, pixelPerfect: false });
    this.sprite.play(`${texKey}_idle`);

    // Status dot
    this.statusDot = scene.add.arc(x + 14, y - 22, 4, 0, 360, false, 0x00ff88).setDepth(6);

    // Name label
    this.label = scene.add.text(x, y + 28, def.label.replace('Nova ', '').toUpperCase(), {
      fontFamily: 'Space Mono',
      fontSize: '9px',
      color: def.cssColor,
      align: 'center',
    }).setOrigin(0.5, 0).setDepth(6);

    // Idle bob
    scene.tweens.add({
      targets: this.sprite,
      y: y - 3,
      duration: 1200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      delay: Math.random() * 1200,
    });

    // Click
    this.sprite.on('pointerdown', () => {
      scene.events.emit('agent-clicked', agentId);
    });

    this.sprite.on('pointerover', () => {
      scene.events.emit('agent-hover', agentId);
      this.sprite.setTint(0xffffff);
    });

    this.sprite.on('pointerout', () => {
      scene.events.emit('agent-hover-end', agentId);
      this.sprite.clearTint();
    });
  }

  /** Move agent to a zone's centre */
  walkToZone(zoneKey: string) {
    const zone = ZONES[zoneKey];
    if (!zone) return;

    const tx = zone.x + Phaser.Math.Between(-zone.w / 3, zone.w / 3);
    const ty = zone.y + Phaser.Math.Between(-zone.h / 3, zone.h / 3);

    this.state.targetX = tx;
    this.state.targetY = ty;
    this.state.currentZone = zoneKey;
    this.state.isAnimating = true;

    // Play walk animation
    const texKey = `agent_${this.agentId}`;
    this.sprite.play(`${texKey}_walk`);

    // Flip sprite if walking left
    if (tx < this.state.x) this.sprite.setFlipX(true);
    else this.sprite.setFlipX(false);

    // Kill any existing walk tween
    if (this.walkTween) this.walkTween.destroy();

    this.walkTween = this.scene.tweens.add({
      targets: this.sprite,
      x: tx,
      y: ty,
      duration: 1800,
      ease: 'Power2.easeInOut',
      onComplete: () => {
        this.state.x = tx;
        this.state.y = ty;
        this.state.isAnimating = false;
        this.sprite.play(`${texKey}_idle`);

        // Restart idle bob at new position
        this.scene.tweens.killTweensOf(this.sprite);
        this.scene.tweens.add({
          targets: this.sprite,
          y: ty - 3,
          duration: 1200,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      },
    });

    // Move shadow + label + dot in sync
    this.scene.tweens.add({
      targets: this.shadow,
      x: tx,
      y: ty + 20,
      duration: 1800,
      ease: 'Power2.easeInOut',
    });

    this.scene.tweens.add({
      targets: this.label,
      x: tx,
      y: ty + 28,
      duration: 1800,
      ease: 'Power2.easeInOut',
    });

    this.scene.tweens.add({
      targets: this.statusDot,
      x: tx + 14,
      y: ty - 22,
      duration: 1800,
      ease: 'Power2.easeInOut',
    });
  }

  /** Show floating action bubble above agent */
  showAction(icon: string, msg: string, color: string) {
    this.clearBubble();

    const bubble = this.scene.add.container(this.state.x, this.state.y - 50);
    bubble.setDepth(20);

    const bg = this.scene.add.rectangle(0, 0, Math.min(msg.length * 7 + 32, 180), 28, 0x0a0a0a)
      .setStrokeStyle(1, parseInt(color.replace('#', ''), 16));

    const text = this.scene.add.text(0, 0, `${icon} ${msg}`, {
      fontFamily: 'Space Mono',
      fontSize: '9px',
      color,
      align: 'center',
    }).setOrigin(0.5, 0.5);

    bubble.add([bg, text]);
    this.actionBubble = bubble;

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
    this.scene.tweens.add({
      targets: this.sprite,
      scaleX: 1.3,
      scaleY: 1.3,
      duration: 150,
      yoyo: true,
      repeat: 1,
    });
  }

  getPosition(): { x: number; y: number } {
    return { x: this.state.x, y: this.state.y };
  }

  destroy() {
    this.clearBubble();
    if (this.walkTween) this.walkTween.destroy();
    this.sprite.destroy();
    this.shadow.destroy();
    this.label.destroy();
    this.statusDot.destroy();
  }
}
