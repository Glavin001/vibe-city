import * as THREE from "three";
import { Skybox } from "./Skybox";

class Ground extends THREE.Mesh {
  constructor() {
    const geometry = new THREE.CircleGeometry(500, 64);
    const material = new THREE.MeshStandardMaterial({ color: 0x228b22 });
    super(geometry, material);
    this.rotation.x = -Math.PI / 2;
    this.receiveShadow = true;
  }
}

class Grass extends THREE.InstancedMesh {
  _instanceCount: number;
  constructor(count = 1000) {
    const geo = new THREE.PlaneGeometry(0.5, 1);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x228b22,
      side: THREE.DoubleSide,
    });
    super(geo, mat, 25000);
    this.frustumCulled = false;
    this._instanceCount = count;
    this.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.populate();
  }
  populate() {
    const dummy = new THREE.Object3D();
    for (let i = 0; i < this._instanceCount; i++) {
      const x = Math.random() * 500 - 250;
      const z = Math.random() * 500 - 250;
      dummy.position.set(x, 0, z);
      dummy.rotation.y = Math.random() * Math.PI;
      dummy.updateMatrix();
      this.setMatrixAt(i, dummy.matrix);
    }
    this.count = this._instanceCount;
    this.instanceMatrix.needsUpdate = true;
  }
  set instanceCount(v: number) {
    this._instanceCount = v;
    this.populate();
  }
  get instanceCount() {
    return this._instanceCount;
  }
}

export class Environment extends THREE.Group {
  skybox: Skybox;
  grass: Grass;
  constructor() {
    super();
    this.skybox = new Skybox();
    this.add(this.skybox);
    const ground = new Ground();
    this.add(ground);
    this.grass = new Grass(5000);
    this.add(this.grass);
  }
}
