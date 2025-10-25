import * as THREE from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

import { volumetricCompositeShader } from "./shaders/volumetricComposite";

export type VolumetricPassOptions = {
  densityAtlas: THREE.Texture;
  grid: number;
  tileMin: THREE.Vector3;
  tileMax: THREE.Vector3;
  kappa_m2_per_kg: number;
  albedo: THREE.Color;
  stepWorld: number;
  maxSteps: number;
};

export class VolumetricCompositePass {
  readonly pass: ShaderPass;

  constructor(opts: VolumetricPassOptions) {
    const tilesX = Math.ceil(Math.sqrt(opts.grid));
    const tilesY = Math.ceil(opts.grid / tilesX);
    const uniforms: Record<string, THREE.IUniform> = {
      tScene: { value: null },
      tDepth: { value: null },
      tDensity: { value: opts.densityAtlas },
      uGrid: { value: opts.grid },
      uTilesX: { value: tilesX },
      uTilesY: { value: tilesY },
      uAtlasSize: {
        value: new THREE.Vector2(tilesX * opts.grid, tilesY * opts.grid),
      },
      uTileMin: { value: opts.tileMin.clone() },
      uTileMax: { value: opts.tileMax.clone() },
      uVoxelWorldSize: {
        value: (opts.tileMax.x - opts.tileMin.x) / opts.grid,
      },
      uKappa: { value: opts.kappa_m2_per_kg },
      uAlbedo: { value: opts.albedo.clone() },
      uStepWorld: { value: opts.stepWorld },
      uMaxSteps: { value: opts.maxSteps },
      uProjectionMatrix: { value: new THREE.Matrix4() },
      uViewMatrix: { value: new THREE.Matrix4() },
      uInvProjectionMatrix: { value: new THREE.Matrix4() },
      uInvViewMatrix: { value: new THREE.Matrix4() },
    };

    this.pass = new ShaderPass({
      uniforms,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: volumetricCompositeShader,
    });
    (this.pass as unknown as { needsSwap: boolean }).needsSwap = true;
  }

  setUniforms(u: {
    densityAtlas?: THREE.Texture;
    tileMin?: THREE.Vector3;
    tileMax?: THREE.Vector3;
    projectionMatrix?: THREE.Matrix4;
    invProjectionMatrix?: THREE.Matrix4;
    viewMatrix?: THREE.Matrix4;
    invViewMatrix?: THREE.Matrix4;
    voxelWorldSize?: number;
  }) {
    const uniforms = this.pass.uniforms as Record<string, THREE.IUniform>;
    if (u.densityAtlas) uniforms.tDensity.value = u.densityAtlas;
    if (u.tileMin) (uniforms.uTileMin.value as THREE.Vector3).copy(u.tileMin);
    if (u.tileMax) (uniforms.uTileMax.value as THREE.Vector3).copy(u.tileMax);
    if (u.projectionMatrix)
      (uniforms.uProjectionMatrix.value as THREE.Matrix4).copy(
        u.projectionMatrix,
      );
    if (u.invProjectionMatrix)
      (uniforms.uInvProjectionMatrix.value as THREE.Matrix4).copy(
        u.invProjectionMatrix,
      );
    if (u.viewMatrix)
      (uniforms.uViewMatrix.value as THREE.Matrix4).copy(u.viewMatrix);
    if (u.invViewMatrix)
      (uniforms.uInvViewMatrix.value as THREE.Matrix4).copy(u.invViewMatrix);
    if (u.voxelWorldSize !== undefined)
      uniforms.uVoxelWorldSize.value = u.voxelWorldSize;
  }
}
