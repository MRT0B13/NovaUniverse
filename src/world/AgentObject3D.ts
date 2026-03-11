import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { CollisionWorld } from './CollisionWorld';

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
  public mixer: THREE.AnimationMixer;
  public color: number;
  public cssColor: string;
  public state: AgentState3D;

  private idleAction: THREE.AnimationAction | null;
  private walkAction: THREE.AnimationAction | null;

  // Floating action bubble (DOM-based, positioned via 3D projection)
  private bubbleDiv: HTMLElement | null = null;
  private bubbleTimeout: ReturnType<typeof setTimeout> | null = null;

  // Grounded Y position (computed once at spawn)
  private groundY = 0;

  constructor(
    agentId: string,
    model: THREE.Object3D,
    mixer: THREE.AnimationMixer,
    idleAction: THREE.AnimationAction | null,
    walkAction: THREE.AnimationAction | null,
    color: number,
    cssColor: string,
  ) {
    this.agentId    = agentId;
    this.model      = model;
    this.mixer      = mixer;
    this.idleAction = idleAction;
    this.walkAction = walkAction;
    this.color      = color;
    this.cssColor   = cssColor;
    this.groundY    = model.position.y;
    this.state      = {
      agentId,
      status: 'running',
      currentZone: '',
      messages24h: 0,
      isWalking: false,
    };
  }

  /**
   * Factory: load a GLTF agent, ground it, set up animations correctly.
   * Pass the raw GLTF result (not just gltf.scene) so we get gltf.animations.
   */
  static async load(
    scene: THREE.Scene,
    agentId: string,
    gltf: GLTF,
    tex: THREE.Texture | null,
    color: number,
    cssColor: string,
    spawnX: number,
    spawnZ: number,
  ): Promise<AgentObject3D> {
    const model = gltf.scene;

    // 1. Apply texture + emissive tint
    model.traverse(child => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        const mat = new THREE.MeshLambertMaterial({ map: tex ?? undefined });
        mat.emissive = new THREE.Color(color).multiplyScalar(0.15);
        child.material = mat;
      }
    });

    // 2. Scale first, then ground — compute bounding box after scale applied
    model.scale.setScalar(0.8);
    model.position.set(spawnX, 0, spawnZ);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const bottomY = box.min.y;
    model.position.y = -bottomY; // offset so feet sit at Y=0

    // 3. Animations — use gltf.animations (NOT gltf.scene.__gltfAnimations)
    const mixer = new THREE.AnimationMixer(model);
    const clips = gltf.animations;

    const findClip = (name: string) =>
      clips.find(c => c.name.toLowerCase().includes(name.toLowerCase()));

    const idleClip = findClip('idle') ?? findClip('stand') ?? clips[0] ?? null;
    const walkClip = findClip('walk') ?? findClip('run')  ?? clips[1] ?? clips[0] ?? null;

    const idleAction = idleClip ? mixer.clipAction(idleClip) : null;
    const walkAction = walkClip ? mixer.clipAction(walkClip) : null;

    // Start idle
    idleAction?.play();

    scene.add(model);

    return new AgentObject3D(agentId, model, mixer, idleAction, walkAction, color, cssColor);
  }

  // ── Walk to world position (collision-aware) ───────────────────────────────

  walkTo(tx: number, tz: number, collision?: CollisionWorld) {
    if (this.state.isWalking) return;
    this.state.isWalking = true;

    // Resolve destination through collision if available
    let destX = tx, destZ = tz;
    if (collision) {
      const from = this.model.position.clone();
      const to   = new THREE.Vector3(tx, from.y, tz);
      const safe = collision.resolveMove(from, to, 0.4);
      destX = safe.x;
      destZ = safe.z;
    }

    // Face direction of travel
    const dx = destX - this.model.position.x;
    const dz = destZ - this.model.position.z;
    this.model.rotation.y = Math.atan2(dx, dz);

    // Transition to walk animation
    if (this.walkAction && this.idleAction) {
      this.idleAction.fadeOut(0.2);
      this.walkAction.reset().fadeIn(0.2).play();
    }

    const startX = this.model.position.x;
    const startZ = this.model.position.z;
    const duration = 2200;
    const startMs = performance.now();

    const tick = () => {
      const t = Math.min((performance.now() - startMs) / duration, 1);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      this.model.position.x = startX + (destX - startX) * ease;
      this.model.position.z = startZ + (destZ - startZ) * ease;
      this.model.position.y = this.groundY; // never drift off ground

      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        this.state.isWalking = false;
        if (this.walkAction && this.idleAction) {
          this.walkAction.fadeOut(0.2);
          this.idleAction.reset().fadeIn(0.2).play();
        }
      }
    };
    requestAnimationFrame(tick);
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
