import * as THREE from 'three';

// ── Agent State ────────────────────────────────────────────────────────────────

export interface AgentState3D {
  agentId: string;
  status: string;
  currentZone: string;
  messages24h: number;
  isWalking: boolean;
}

// ── Agent 3D Object ────────────────────────────────────────────────────────────

export class AgentObject3D {
  public agentId: string;
  public model: THREE.Object3D;
  public color: number;
  public cssColor: string;
  public state: AgentState3D;

  private mixer: THREE.AnimationMixer | null;
  private walkClip: THREE.AnimationAction | null = null;
  private idleClip: THREE.AnimationAction | null = null;

  // Floating action bubble (DOM-based, positioned via 3D projection)
  private bubbleDiv: HTMLElement | null = null;
  private bubbleTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    agentId: string,
    model: THREE.Object3D,
    mixer: THREE.AnimationMixer | null,
    color: number,
    cssColor: string,
    animations: THREE.AnimationClip[] = [],
  ) {
    this.agentId  = agentId;
    this.model    = model;
    this.mixer    = mixer;
    this.color    = color;
    this.cssColor = cssColor;
    this.state    = {
      agentId,
      status: 'running',
      currentZone: '',
      messages24h: 0,
      isWalking: false,
    };

    if (mixer && animations.length > 0) {
      const idleC = animations.find(c => c.name.toLowerCase().includes('idle')) ?? animations[0];
      const walkC = animations.find(c => c.name.toLowerCase().includes('walk'))
                 ?? animations[1]
                 ?? animations[0];
      if (idleC) { this.idleClip = mixer.clipAction(idleC); this.idleClip.play(); }
      if (walkC) this.walkClip = mixer.clipAction(walkC);
    }
  }

  // ── Walk to world position ─────────────────────────────────────────────────

  walkTo(tx: number, tz: number, _mixers: THREE.AnimationMixer[]) {
    if (this.state.isWalking) return;
    this.state.isWalking = true;

    // Face direction of travel
    const dx = tx - this.model.position.x;
    const dz = tz - this.model.position.z;
    this.model.rotation.y = Math.atan2(dx, dz);

    // Switch to walk animation
    if (this.walkClip && this.idleClip) {
      this.idleClip.stop();
      this.walkClip.reset().play();
    }

    const duration = 2000;
    const start = { x: this.model.position.x, z: this.model.position.z };
    const startMs = performance.now();

    const tick = () => {
      const t = Math.min((performance.now() - startMs) / duration, 1);
      // Ease in-out quad
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      this.model.position.x = start.x + (tx - start.x) * ease;
      this.model.position.z = start.z + (tz - start.z) * ease;

      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        this.state.isWalking = false;
        if (this.walkClip && this.idleClip) {
          this.walkClip.stop();
          this.idleClip.reset().play();
        }
      }
    };
    tick();
  }

  // ── Action bubble (floating DOM label projected from 3D) ───────────────────

  showAction(icon: string, msg: string, color: string) {
    this.clearBubble();

    const div = document.createElement('div');
    div.style.cssText =
      'position:fixed;background:rgba(6,6,6,0.95);border:1px solid ' + color + ';' +
      'border-radius:4px;padding:4px 10px;font-family:"Space Mono",monospace;' +
      'font-size:10px;color:' + color + ';pointer-events:none;z-index:100;' +
      'white-space:nowrap;transition:opacity 0.5s;';
    const truncated = msg.length > 30 ? msg.slice(0, 30) + '…' : msg;
    div.textContent = icon + ' ' + truncated;
    document.body.appendChild(div);
    this.bubbleDiv = div;

    this.bubbleTimeout = setTimeout(() => {
      if (this.bubbleDiv) {
        this.bubbleDiv.style.opacity = '0';
        setTimeout(() => this.clearBubble(), 500);
      }
    }, 3000);
  }

  updateBubble(camera: THREE.Camera) {
    if (!this.bubbleDiv) return;

    const pos = this.model.position.clone();
    pos.y += 1.5;
    pos.project(camera);

    // Check if behind camera
    if (pos.z > 1) {
      this.bubbleDiv.style.display = 'none';
      return;
    }
    this.bubbleDiv.style.display = '';

    const x = (pos.x * 0.5 + 0.5) * window.innerWidth;
    const y = (pos.y * -0.5 + 0.5) * window.innerHeight;
    this.bubbleDiv.style.left = (x - this.bubbleDiv.offsetWidth / 2) + 'px';
    this.bubbleDiv.style.top  = (y - 30) + 'px';
  }

  private clearBubble() {
    if (this.bubbleTimeout) { clearTimeout(this.bubbleTimeout); this.bubbleTimeout = null; }
    if (this.bubbleDiv) { this.bubbleDiv.remove(); this.bubbleDiv = null; }
  }

  // ── Visual feedback ────────────────────────────────────────────────────────

  flash() {
    const origScale = this.model.scale.x;
    this.model.scale.setScalar(origScale * 1.4);
    setTimeout(() => this.model.scale.setScalar(origScale), 200);
  }

  setStatus(status: string) {
    this.state.status = status;
    const alpha = status === 'running' ? 1 : 0.5;
    this.model.traverse(child => {
      if (child instanceof THREE.Mesh && child.material) {
        const mat = child.material as THREE.MeshStandardMaterial;
        mat.opacity = alpha;
        mat.transparent = alpha < 1;
        mat.needsUpdate = true;
      }
    });
  }

  destroy() {
    this.clearBubble();
    this.model.removeFromParent();
  }
}
