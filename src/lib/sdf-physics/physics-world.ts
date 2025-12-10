/**
 * Rapier-like Physics World API for WebGPU SDF Physics
 *
 * Provides a familiar API similar to Rapier.js for creating
 * rigid bodies and colliders that simulate on the GPU.
 */

import type { GpuSdf } from "./sdf-gpu";
import { physicsComputeShader } from "./shaders/physics-compute";
import { updateSdfUniformBuffer, createSdfUniformBuffer } from "./sdf-gpu";

// ============================================================================
// Types
// ============================================================================

export enum ShapeType {
  Ball = 0,
  Box = 1,
  Capsule = 2,
}

export enum RigidBodyType {
  Dynamic = 0,
  Fixed = 1,
  KinematicPositionBased = 2,
  KinematicVelocityBased = 3,
}

// ============================================================================
// Collider Description
// ============================================================================

export class ColliderDesc {
  shape: ShapeType = ShapeType.Ball;
  radius: number = 0.5;
  halfExtents: [number, number, number] = [0.5, 0.5, 0.5];
  halfHeight: number = 0.5; // For capsule

  static ball(radius: number): ColliderDesc {
    const desc = new ColliderDesc();
    desc.shape = ShapeType.Ball;
    desc.radius = radius;
    return desc;
  }

  static cuboid(hx: number, hy: number, hz: number): ColliderDesc {
    const desc = new ColliderDesc();
    desc.shape = ShapeType.Box;
    desc.halfExtents = [hx, hy, hz];
    return desc;
  }

  static capsule(halfHeight: number, radius: number): ColliderDesc {
    const desc = new ColliderDesc();
    desc.shape = ShapeType.Capsule;
    desc.halfHeight = halfHeight;
    desc.radius = radius;
    return desc;
  }
}

// ============================================================================
// Rigid Body Description
// ============================================================================

export class RigidBodyDesc {
  type: RigidBodyType = RigidBodyType.Dynamic;
  translation: [number, number, number] = [0, 0, 0];
  rotation: [number, number, number, number] = [0, 0, 0, 1]; // quaternion (x, y, z, w)
  linearVelocity: [number, number, number] = [0, 0, 0];
  angularVelocity: [number, number, number] = [0, 0, 0];
  gravityScale: number = 1.0;
  linearDamping: number = 0.05;  // Energy loss over time
  angularDamping: number = 0.2;  // Rotation slows down
  canSleep: boolean = true;

  static dynamic(): RigidBodyDesc {
    const desc = new RigidBodyDesc();
    desc.type = RigidBodyType.Dynamic;
    return desc;
  }

  static fixed(): RigidBodyDesc {
    const desc = new RigidBodyDesc();
    desc.type = RigidBodyType.Fixed;
    return desc;
  }

  static kinematicPositionBased(): RigidBodyDesc {
    const desc = new RigidBodyDesc();
    desc.type = RigidBodyType.KinematicPositionBased;
    return desc;
  }

  static kinematicVelocityBased(): RigidBodyDesc {
    const desc = new RigidBodyDesc();
    desc.type = RigidBodyType.KinematicVelocityBased;
    return desc;
  }

  setTranslation(x: number, y: number, z: number): this {
    this.translation = [x, y, z];
    return this;
  }

  setRotation(x: number, y: number, z: number, w: number): this {
    this.rotation = [x, y, z, w];
    return this;
  }

  setLinvel(x: number, y: number, z: number): this {
    this.linearVelocity = [x, y, z];
    return this;
  }

  setAngvel(x: number, y: number, z: number): this {
    this.angularVelocity = [x, y, z];
    return this;
  }

  setGravityScale(scale: number): this {
    this.gravityScale = scale;
    return this;
  }

  setLinearDamping(damping: number): this {
    this.linearDamping = damping;
    return this;
  }

  setAngularDamping(damping: number): this {
    this.angularDamping = damping;
    return this;
  }

  setCanSleep(canSleep: boolean): this {
    this.canSleep = canSleep;
    return this;
  }
}

// ============================================================================
// Rigid Body Handle
// ============================================================================

export class RigidBody {
  readonly handle: number;
  private world: SdfWorld;

  constructor(handle: number, world: SdfWorld) {
    this.handle = handle;
    this.world = world;
  }

  translation(): { x: number; y: number; z: number } {
    const data = this.world.getBodyData(this.handle);
    return { x: data.posX, y: data.posY, z: data.posZ };
  }

  rotation(): { x: number; y: number; z: number; w: number } {
    const data = this.world.getBodyData(this.handle);
    return { x: data.rotX, y: data.rotY, z: data.rotZ, w: data.rotW };
  }

  linvel(): { x: number; y: number; z: number } {
    const data = this.world.getBodyData(this.handle);
    return { x: data.velX, y: data.velY, z: data.velZ };
  }

  angvel(): { x: number; y: number; z: number } {
    const data = this.world.getBodyData(this.handle);
    return { x: data.angVelX, y: data.angVelY, z: data.angVelZ };
  }

  setTranslation(translation: { x: number; y: number; z: number }, wakeUp = true): void {
    this.world.setBodyTranslation(this.handle, translation.x, translation.y, translation.z);
  }

  setRotation(rotation: { x: number; y: number; z: number; w: number }, wakeUp = true): void {
    this.world.setBodyRotation(this.handle, rotation.x, rotation.y, rotation.z, rotation.w);
  }

  setLinvel(linvel: { x: number; y: number; z: number }, wakeUp = true): void {
    this.world.setBodyLinvel(this.handle, linvel.x, linvel.y, linvel.z);
  }

  setAngvel(angvel: { x: number; y: number; z: number }, wakeUp = true): void {
    this.world.setBodyAngvel(this.handle, angvel.x, angvel.y, angvel.z);
  }

  applyImpulse(impulse: { x: number; y: number; z: number }, wakeUp = true): void {
    const data = this.world.getBodyData(this.handle);
    this.world.setBodyLinvel(
      this.handle,
      data.velX + impulse.x * data.invMass,
      data.velY + impulse.y * data.invMass,
      data.velZ + impulse.z * data.invMass
    );
  }
}

// ============================================================================
// Internal Body Data Structure
// ============================================================================

interface BodyInternal {
  // Position + invMass (4 floats)
  posX: number;
  posY: number;
  posZ: number;
  invMass: number;

  // Velocity + type (4 floats)
  velX: number;
  velY: number;
  velZ: number;
  bodyType: number;

  // Rotation quaternion (4 floats)
  rotX: number;
  rotY: number;
  rotZ: number;
  rotW: number;

  // Angular velocity + flags (4 floats)
  angVelX: number;
  angVelY: number;
  angVelZ: number;
  flags: number;

  // Shape params (4 floats)
  shapeType: number;
  param0: number; // radius or hx
  param1: number; // hy or halfHeight
  param2: number; // hz

  // Extra params (4 floats)
  gravityScale: number;
  linearDamping: number;
  angularDamping: number;
  restitution: number;
}

// GPU buffer layout per body: 6 vec4s = 24 floats = 96 bytes
const BODY_STRIDE_FLOATS = 24;
const BODY_STRIDE_BYTES = BODY_STRIDE_FLOATS * 4;

// ============================================================================
// SDF Physics World
// ============================================================================

export interface SdfWorldConfig {
  maxBodies?: number;
  gravity?: [number, number, number];
  restitution?: number;
  friction?: number;
}

export class SdfWorld {
  private device: GPUDevice;
  private sdf: GpuSdf;
  private bodies: BodyInternal[] = [];
  private rigidBodies: RigidBody[] = [];
  private maxBodies: number;

  // GPU resources
  private bodyBuffer: GPUBuffer;
  private bodyReadBuffer: GPUBuffer;
  private uniformBuffer: GPUBuffer;
  private computePipeline: GPUComputePipeline | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  private bindGroup: GPUBindGroup | null = null;

  // Simulation params
  gravity: [number, number, number];
  restitution: number;
  friction: number;

  // Shape counts for stats
  private _ballCount = 0;
  private _boxCount = 0;
  private _capsuleCount = 0;

  // State
  private dirty = true;
  private needsReadback = false;

  constructor(device: GPUDevice, sdf: GpuSdf, config: SdfWorldConfig = {}) {
    this.device = device;
    this.sdf = sdf;
    this.maxBodies = config.maxBodies ?? 100_000;
    this.gravity = config.gravity ?? [0, -9.8, 0];
    this.restitution = config.restitution ?? 0.3;
    this.friction = config.friction ?? 0.5;

    // Create body buffer (read-write for compute shader)
    this.bodyBuffer = device.createBuffer({
      label: "Body Buffer",
      size: this.maxBodies * BODY_STRIDE_BYTES,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC,
    });

    // Create readback buffer
    this.bodyReadBuffer = device.createBuffer({
      label: "Body Read Buffer",
      size: this.maxBodies * BODY_STRIDE_BYTES,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    // Create uniform buffer
    this.uniformBuffer = createSdfUniformBuffer(device, sdf);

    // Initialize pipeline lazily
    this.initPipeline();
  }

  private async initPipeline(): Promise<void> {
    const shaderModule = this.device.createShaderModule({
      label: "Physics Compute Shader",
      code: physicsComputeShader,
    });

    this.bindGroupLayout = this.device.createBindGroupLayout({
      label: "Physics Bind Group Layout",
      entries: [
        {
          // SDF 3D texture
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          texture: {
            sampleType: "unfilterable-float",
            viewDimension: "3d",
          },
        },
        {
          // SDF sampler
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          sampler: { type: "non-filtering" },
        },
        {
          // Uniforms
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        },
        {
          // Body buffer
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
      ],
    });

    const pipelineLayout = this.device.createPipelineLayout({
      label: "Physics Pipeline Layout",
      bindGroupLayouts: [this.bindGroupLayout],
    });

    this.computePipeline = this.device.createComputePipeline({
      label: "Physics Compute Pipeline",
      layout: pipelineLayout,
      compute: {
        module: shaderModule,
        entryPoint: "stepBodies",
      },
    });

    this.updateBindGroup();
  }

  private updateBindGroup(): void {
    if (!this.bindGroupLayout) return;

    this.bindGroup = this.device.createBindGroup({
      label: "Physics Bind Group",
      layout: this.bindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: this.sdf.texture.createView(),
        },
        {
          binding: 1,
          resource: this.sdf.sampler,
        },
        {
          binding: 2,
          resource: { buffer: this.uniformBuffer },
        },
        {
          binding: 3,
          resource: { buffer: this.bodyBuffer },
        },
      ],
    });
  }

  /**
   * Create a new rigid body
   */
  createRigidBody(desc: RigidBodyDesc): RigidBody {
    const handle = this.bodies.length;

    const body: BodyInternal = {
      posX: desc.translation[0],
      posY: desc.translation[1],
      posZ: desc.translation[2],
      invMass: desc.type === RigidBodyType.Dynamic ? 1.0 : 0.0,

      velX: desc.linearVelocity[0],
      velY: desc.linearVelocity[1],
      velZ: desc.linearVelocity[2],
      bodyType: desc.type,

      rotX: desc.rotation[0],
      rotY: desc.rotation[1],
      rotZ: desc.rotation[2],
      rotW: desc.rotation[3],

      angVelX: desc.angularVelocity[0],
      angVelY: desc.angularVelocity[1],
      angVelZ: desc.angularVelocity[2],
      flags: 0,

      // Default shape (ball r=0.5), will be overwritten by attachCollider
      shapeType: ShapeType.Ball,
      param0: 0.5,
      param1: 0,
      param2: 0,

      gravityScale: desc.gravityScale,
      linearDamping: desc.linearDamping,
      angularDamping: desc.angularDamping,
      restitution: this.restitution,
    };

    this.bodies.push(body);
    this.dirty = true;

    const rb = new RigidBody(handle, this);
    this.rigidBodies.push(rb);
    return rb;
  }

  /**
   * Attach a collider to a rigid body
   */
  createCollider(desc: ColliderDesc, body: RigidBody): void {
    const b = this.bodies[body.handle];
    if (!b) return;

    // Only decrement if this body already had a collider attached (shapeType was set)
    // We use a flag in body to track if collider was previously set
    const hadPreviousCollider = (b.flags & 1) !== 0;
    if (hadPreviousCollider) {
      // Decrement old shape count
      if (b.shapeType === ShapeType.Ball) this._ballCount--;
      else if (b.shapeType === ShapeType.Box) this._boxCount--;
      else if (b.shapeType === ShapeType.Capsule) this._capsuleCount--;
    }

    // Mark that this body now has a collider
    b.flags |= 1;

    b.shapeType = desc.shape;

    switch (desc.shape) {
      case ShapeType.Ball:
        b.param0 = desc.radius;
        b.param1 = 0;
        b.param2 = 0;
        this._ballCount++;
        break;
      case ShapeType.Box:
        b.param0 = desc.halfExtents[0];
        b.param1 = desc.halfExtents[1];
        b.param2 = desc.halfExtents[2];
        this._boxCount++;
        break;
      case ShapeType.Capsule:
        b.param0 = desc.radius;
        b.param1 = desc.halfHeight;
        b.param2 = 0;
        this._capsuleCount++;
        break;
    }

    this.dirty = true;
  }

  /**
   * Get body data (for internal use and RigidBody class)
   */
  getBodyData(handle: number): BodyInternal {
    return this.bodies[handle];
  }

  setBodyTranslation(handle: number, x: number, y: number, z: number): void {
    const b = this.bodies[handle];
    if (!b) return;
    b.posX = x;
    b.posY = y;
    b.posZ = z;
    this.dirty = true;
  }

  setBodyRotation(handle: number, x: number, y: number, z: number, w: number): void {
    const b = this.bodies[handle];
    if (!b) return;
    b.rotX = x;
    b.rotY = y;
    b.rotZ = z;
    b.rotW = w;
    this.dirty = true;
  }

  setBodyLinvel(handle: number, x: number, y: number, z: number): void {
    const b = this.bodies[handle];
    if (!b) return;
    b.velX = x;
    b.velY = y;
    b.velZ = z;
    this.dirty = true;
  }

  setBodyAngvel(handle: number, x: number, y: number, z: number): void {
    const b = this.bodies[handle];
    if (!b) return;
    b.angVelX = x;
    b.angVelY = y;
    b.angVelZ = z;
    this.dirty = true;
  }

  /**
   * Upload body data to GPU
   */
  private uploadBodies(): void {
    if (!this.dirty || this.bodies.length === 0) return;

    const numBodies = this.bodies.length;
    const data = new Float32Array(numBodies * BODY_STRIDE_FLOATS);

    for (let i = 0; i < numBodies; i++) {
      const b = this.bodies[i];
      const offset = i * BODY_STRIDE_FLOATS;

      // vec4 0: position + invMass
      data[offset + 0] = b.posX;
      data[offset + 1] = b.posY;
      data[offset + 2] = b.posZ;
      data[offset + 3] = b.invMass;

      // vec4 1: velocity + bodyType
      data[offset + 4] = b.velX;
      data[offset + 5] = b.velY;
      data[offset + 6] = b.velZ;
      data[offset + 7] = b.bodyType;

      // vec4 2: rotation quaternion
      data[offset + 8] = b.rotX;
      data[offset + 9] = b.rotY;
      data[offset + 10] = b.rotZ;
      data[offset + 11] = b.rotW;

      // vec4 3: angular velocity + flags
      data[offset + 12] = b.angVelX;
      data[offset + 13] = b.angVelY;
      data[offset + 14] = b.angVelZ;
      data[offset + 15] = b.flags;

      // vec4 4: shape params
      data[offset + 16] = b.shapeType;
      data[offset + 17] = b.param0;
      data[offset + 18] = b.param1;
      data[offset + 19] = b.param2;

      // vec4 5: extra params
      data[offset + 20] = b.gravityScale;
      data[offset + 21] = b.linearDamping;
      data[offset + 22] = b.angularDamping;
      data[offset + 23] = b.restitution;
    }

    this.device.queue.writeBuffer(this.bodyBuffer, 0, data);
    this.dirty = false;
  }

  /**
   * Step the physics simulation
   */
  step(dt: number = 1 / 60): void {
    if (!this.computePipeline || !this.bindGroup) return;
    if (this.bodies.length === 0) return;

    // Upload body data if changed
    this.uploadBodies();

    // Update uniforms
    updateSdfUniformBuffer(this.device, this.uniformBuffer, this.sdf, {
      dt,
      gravity: Math.abs(this.gravity[1]),
      numBodies: this.bodies.length,
    });

    // Dispatch compute shader
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();

    pass.setPipeline(this.computePipeline);
    pass.setBindGroup(0, this.bindGroup);

    const workgroupSize = 64;
    const numGroups = Math.ceil(this.bodies.length / workgroupSize);
    pass.dispatchWorkgroups(numGroups);

    pass.end();

    this.device.queue.submit([encoder.finish()]);
    this.needsReadback = true;
  }

  /**
   * Read back body data from GPU (async)
   */
  async readBack(): Promise<void> {
    if (!this.needsReadback || this.bodies.length === 0) return;

    const numBodies = this.bodies.length;
    const byteSize = numBodies * BODY_STRIDE_BYTES;

    // Copy from body buffer to read buffer
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(this.bodyBuffer, 0, this.bodyReadBuffer, 0, byteSize);
    this.device.queue.submit([encoder.finish()]);

    // Map and read
    await this.bodyReadBuffer.mapAsync(GPUMapMode.READ, 0, byteSize);
    const data = new Float32Array(this.bodyReadBuffer.getMappedRange(0, byteSize).slice(0));
    this.bodyReadBuffer.unmap();

    // Update JS-side body data
    for (let i = 0; i < numBodies; i++) {
      const b = this.bodies[i];
      const offset = i * BODY_STRIDE_FLOATS;

      b.posX = data[offset + 0];
      b.posY = data[offset + 1];
      b.posZ = data[offset + 2];

      b.velX = data[offset + 4];
      b.velY = data[offset + 5];
      b.velZ = data[offset + 6];

      b.rotX = data[offset + 8];
      b.rotY = data[offset + 9];
      b.rotZ = data[offset + 10];
      b.rotW = data[offset + 11];

      b.angVelX = data[offset + 12];
      b.angVelY = data[offset + 13];
      b.angVelZ = data[offset + 14];
    }

    this.needsReadback = false;
  }

  /**
   * Get body buffer for direct GPU rendering
   */
  getBodyBuffer(): GPUBuffer {
    return this.bodyBuffer;
  }

  /**
   * Get number of bodies
   */
  get numBodies(): number {
    return this.bodies.length;
  }

  /**
   * Get shape counts
   */
  get ballCount(): number {
    return this._ballCount;
  }

  get boxCount(): number {
    return this._boxCount;
  }

  get capsuleCount(): number {
    return this._capsuleCount;
  }

  /**
   * Get all rigid body handles
   */
  getRigidBodies(): RigidBody[] {
    return this.rigidBodies;
  }

  /**
   * Remove all bodies
   */
  clear(): void {
    this.bodies = [];
    this.rigidBodies = [];
    this._ballCount = 0;
    this._boxCount = 0;
    this._capsuleCount = 0;
    this.dirty = true;
  }

  /**
   * Dispose GPU resources
   */
  dispose(): void {
    this.bodyBuffer.destroy();
    this.bodyReadBuffer.destroy();
    this.uniformBuffer.destroy();
  }
}




