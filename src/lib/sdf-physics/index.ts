/**
 * SDF Physics Library
 *
 * A WebGPU-based rigid body particle physics library with SDF collision detection.
 * Provides a Rapier-like API for creating physics simulations.
 *
 * @example
 * ```ts
 * import {
 *   bakeGroundPlaneSdf,
 *   uploadSdfToWebGPU,
 *   SdfWorld,
 *   RigidBodyDesc,
 *   ColliderDesc,
 *   SdfPhysicsRenderer,
 * } from '@/lib/sdf-physics';
 *
 * // Bake an SDF from a ground plane
 * const bakedSdf = bakeGroundPlaneSdf({ size: 50, resolution: 64 });
 *
 * // Upload to GPU
 * const gpuSdf = uploadSdfToWebGPU(device, bakedSdf);
 *
 * // Create physics world
 * const world = new SdfWorld(device, gpuSdf);
 *
 * // Create a rigid body
 * const rb = world.createRigidBody(
 *   RigidBodyDesc.dynamic().setTranslation(0, 10, 0)
 * );
 *
 * // Attach a collider
 * world.createCollider(ColliderDesc.ball(0.5), rb);
 *
 * // Step simulation
 * world.step(1/60);
 * ```
 */

// SDF Baking
export {
  bakeGeometryToSdf,
  bakeSceneToSdf,
  bakeGroundPlaneSdf,
  bakeTerrainWithObstaclesSdf,
  generateRandomObstacles,
  combineSDFs,
  sampleSdf,
  type BakedSDF,
  type BakeOptions,
  type TerrainObstacle,
  type TerrainOptions,
} from "./sdf-bake";

// GPU Upload
export {
  uploadSdfToWebGPU,
  createSdfUniformBuffer,
  updateSdfUniformBuffer,
  createSdfBindGroupLayout,
  createSdfBindGroup,
  disposeGpuSdf,
  type GpuSdf,
} from "./sdf-gpu";

// Physics World
export {
  SdfWorld,
  RigidBody,
  RigidBodyDesc,
  ColliderDesc,
  ShapeType,
  RigidBodyType,
  type SdfWorldConfig,
} from "./physics-world";

// WebGPU Renderer
export {
  SdfPhysicsRenderer,
  type Camera,
  type RendererConfig,
} from "./webgpu-renderer";

// Shaders (for custom rendering)
export {
  physicsComputeShader,
} from "./shaders/physics-compute";

export {
  instanceShader,
  instanceVertexShader,
  instanceFragmentShader,
  groundPlaneShader,
  groundPlaneVertexShader,
  groundPlaneFragmentShader,
  sdfEnvironmentVertexShader,
  sdfEnvironmentFragmentShader,
} from "./shaders/render";




