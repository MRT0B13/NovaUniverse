import * as THREE from 'three';

export class VehicleObject3D {
  public model: THREE.Object3D;
  private path: THREE.Vector3[];
  private pathIdx: number;
  private speed = 1.5; // units per second
  private progress = 0;

  constructor(model: THREE.Object3D, path: THREE.Vector3[], startIdx = 0) {
    this.model   = model;
    this.path    = path;
    this.pathIdx = startIdx % path.length;
    model.position.copy(path[this.pathIdx]);
  }

  update(delta: number) {
    if (this.path.length < 2) return;

    const from = this.path[this.pathIdx];
    const to   = this.path[(this.pathIdx + 1) % this.path.length];
    const segLen = from.distanceTo(to);
    if (segLen < 0.001) return;

    this.progress += (this.speed * delta) / segLen;

    if (this.progress >= 1) {
      this.progress = 0;
      this.pathIdx = (this.pathIdx + 1) % this.path.length;
    }

    this.model.position.lerpVectors(from, to, this.progress);

    // Face direction of travel
    const dir = new THREE.Vector3().subVectors(to, from).normalize();
    this.model.rotation.y = Math.atan2(dir.x, dir.z);
  }
}
