import * as THREE from 'three';
import {
  GPUComputationRenderer,
  Variable,
} from 'three/examples/jsm/misc/GPUComputationRenderer.js';

import { advectDensityShader } from './shaders/advectDensity';
import { advectVelocityShader } from './shaders/advectVelocity';

export type SimUpdateOptions = {
  tileMin: THREE.Vector3;
  tileMax: THREE.Vector3;
  emit: boolean;
  emitterCenterLocal: THREE.Vector3;
  emitterRadiusMeters: number;
  emitterMassRateKgPerSec: number;
  buoyancy: number;
  densityDissipation: number;
  velocityDamping: number;
};

const createTexture = (gpu: GPUComputationRenderer) => gpu.createTexture();

export class VolumeTileSim {
  private readonly grid: number;
  private readonly tilesX: number;
  private readonly tilesY: number;
  private readonly atlasW: number;
  private readonly atlasH: number;

  private readonly gpu: GPUComputationRenderer;
  private readonly densVar: Variable;
  private readonly velVar: Variable;

  constructor(renderer: THREE.WebGLRenderer, grid = 64) {
    this.grid = grid;

    this.tilesX = Math.ceil(Math.sqrt(grid));
    this.tilesY = Math.ceil(grid / this.tilesX);
    this.atlasW = this.tilesX * this.grid;
    this.atlasH = this.tilesY * this.grid;

    this.gpu = new GPUComputationRenderer(this.atlasW, this.atlasH, renderer);

    const densTex = createTexture(this.gpu);
    const velTex = createTexture(this.gpu);

    const densArr = densTex.image.data;
    const velArr = velTex.image.data;

    for (let i = 0; i < densArr.length; i += 4) {
      densArr[i] = 0;
      densArr[i + 1] = 0;
      densArr[i + 2] = 0;
      densArr[i + 3] = 0;
    }

    for (let i = 0; i < velArr.length; i += 4) {
      velArr[i] = 0;
      velArr[i + 1] = 0;
      velArr[i + 2] = 0;
      velArr[i + 3] = 0;
    }

    this.densVar = this.gpu.addVariable('tDensity', advectDensityShader, densTex);
    this.velVar = this.gpu.addVariable('tVelocity', advectVelocityShader, velTex);

    this.gpu.setVariableDependencies(this.densVar, [this.densVar, this.velVar]);
    this.gpu.setVariableDependencies(this.velVar, [this.velVar]);

    const baseUniforms = {
      uGrid: { value: this.grid },
      uTilesX: { value: this.tilesX },
      uTilesY: { value: this.tilesY },
      uAtlasSize: { value: new THREE.Vector2(this.atlasW, this.atlasH) },
      uDt: { value: 0.016 },
      uTileMin: { value: new THREE.Vector3() },
      uTileMax: { value: new THREE.Vector3() },
    } satisfies Record<string, THREE.IUniform>;

    (this.densVar.material.uniforms as Record<string, THREE.IUniform>) = {
      ...baseUniforms,
      tVelocity: { value: null },
      uDissipation: { value: 0.985 },
      uEmit: { value: 0 },
      uEmitterCenterLocal: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
      uEmitterRadiusMeters: { value: 0.35 },
      uEmitterMassRateKgPerSec: { value: 0 },
      uVoxelWorldSize: { value: 0.05 },
    };

    (this.velVar.material.uniforms as Record<string, THREE.IUniform>) = {
      ...baseUniforms,
      uDamping: { value: 0.997 },
      uBuoyancy: { value: 0.25 },
      tVelocity: { value: null },
    };

    const initErr = this.gpu.init();
    if (initErr) {
      // eslint-disable-next-line no-console
      console.error(initErr);
    }
  }

  update(dt: number, opts: SimUpdateOptions) {
    const densUniforms = this.densVar.material
      .uniforms as Record<string, THREE.IUniform>;
    const velUniforms = this.velVar.material
      .uniforms as Record<string, THREE.IUniform>;

    densUniforms.uDt.value = dt;
    velUniforms.uDt.value = dt;

    (densUniforms.uTileMin.value as THREE.Vector3).copy(opts.tileMin);
    (densUniforms.uTileMax.value as THREE.Vector3).copy(opts.tileMax);
    (velUniforms.uTileMin.value as THREE.Vector3).copy(opts.tileMin);
    (velUniforms.uTileMax.value as THREE.Vector3).copy(opts.tileMax);

    const voxelWorldSize = (opts.tileMax.x - opts.tileMin.x) / this.grid;
    densUniforms.uVoxelWorldSize.value = voxelWorldSize;

    densUniforms.uDissipation.value = opts.densityDissipation;
    velUniforms.uDamping.value = opts.velocityDamping;
    velUniforms.uBuoyancy.value = opts.buoyancy;

    densUniforms.uEmit.value = opts.emit ? 1 : 0;
    (densUniforms.uEmitterCenterLocal.value as THREE.Vector3).copy(
      opts.emitterCenterLocal,
    );
    densUniforms.uEmitterRadiusMeters.value = opts.emitterRadiusMeters;
    densUniforms.uEmitterMassRateKgPerSec.value = opts.emitterMassRateKgPerSec;

    densUniforms.tVelocity.value = this.getVelocityTexture();

    this.gpu.compute();
  }

  getDensityTexture() {
    return this.gpu.getCurrentRenderTarget(this.densVar).texture;
  }

  getVelocityTexture() {
    return this.gpu.getCurrentRenderTarget(this.velVar).texture;
  }

  dispose() {
    // GPUComputationRenderer cleans up with WebGLRenderer dispose.
  }
}
