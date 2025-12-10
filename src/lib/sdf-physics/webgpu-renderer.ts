/**
 * WebGPU Renderer for SDF Physics
 *
 * Renders rigid bodies as instanced geometry, reading transforms
 * directly from the physics GPU buffer.
 */

import {
  instanceShader,
  groundPlaneShader,
  sdfVisualizerShader,
} from "./shaders/render";

// ============================================================================
// Camera
// ============================================================================

export interface Camera {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  fov: number;
  aspect: number;
  near: number;
  far: number;
}

function createViewMatrix(camera: Camera): Float32Array {
  const [ex, ey, ez] = camera.position;
  const [tx, ty, tz] = camera.target;
  const [ux, uy, uz] = camera.up;

  // Forward
  let fx = tx - ex;
  let fy = ty - ey;
  let fz = tz - ez;
  const fLen = Math.sqrt(fx * fx + fy * fy + fz * fz);
  fx /= fLen;
  fy /= fLen;
  fz /= fLen;

  // Right
  let rx = fy * uz - fz * uy;
  let ry = fz * ux - fx * uz;
  let rz = fx * uy - fy * ux;
  const rLen = Math.sqrt(rx * rx + ry * ry + rz * rz);
  rx /= rLen;
  ry /= rLen;
  rz /= rLen;

  // Up
  const upx = ry * fz - rz * fy;
  const upy = rz * fx - rx * fz;
  const upz = rx * fy - ry * fx;

  return new Float32Array([
    rx, upx, -fx, 0,
    ry, upy, -fy, 0,
    rz, upz, -fz, 0,
    -(rx * ex + ry * ey + rz * ez),
    -(upx * ex + upy * ey + upz * ez),
    (fx * ex + fy * ey + fz * ez),
    1,
  ]);
}

function createProjectionMatrix(camera: Camera): Float32Array {
  const f = 1 / Math.tan(camera.fov / 2);
  const nf = 1 / (camera.near - camera.far);

  return new Float32Array([
    f / camera.aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (camera.far + camera.near) * nf, -1,
    0, 0, 2 * camera.far * camera.near * nf, 0,
  ]);
}

function multiplyMatrices(a: Float32Array, b: Float32Array): Float32Array {
  const result = new Float32Array(16);

  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[k * 4 + j] * b[i * 4 + k];
      }
      result[i * 4 + j] = sum;
    }
  }

  return result;
}

// ============================================================================
// Geometry Generation
// ============================================================================

interface Geometry {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint16Array;
}

function createSphereGeometry(segments = 16, rings = 12): Geometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (let y = 0; y <= rings; y++) {
    const v = y / rings;
    const theta = v * Math.PI;

    for (let x = 0; x <= segments; x++) {
      const u = x / segments;
      const phi = u * Math.PI * 2;

      const nx = Math.sin(theta) * Math.cos(phi);
      const ny = Math.cos(theta);
      const nz = Math.sin(theta) * Math.sin(phi);

      positions.push(nx, ny, nz);
      normals.push(nx, ny, nz);
    }
  }

  for (let y = 0; y < rings; y++) {
    for (let x = 0; x < segments; x++) {
      const a = y * (segments + 1) + x;
      const b = a + segments + 1;

      indices.push(a, b, a + 1);
      indices.push(b, b + 1, a + 1);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
  };
}

function createBoxGeometry(): Geometry {
  // Cube with 24 vertices (4 per face for proper normals)
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  const faces = [
    { dir: [0, 0, 1], up: [0, 1, 0] },   // Front
    { dir: [0, 0, -1], up: [0, 1, 0] },  // Back
    { dir: [0, 1, 0], up: [0, 0, -1] },  // Top
    { dir: [0, -1, 0], up: [0, 0, 1] },  // Bottom
    { dir: [1, 0, 0], up: [0, 1, 0] },   // Right
    { dir: [-1, 0, 0], up: [0, 1, 0] },  // Left
  ];

  faces.forEach((face, faceIndex) => {
    const [dx, dy, dz] = face.dir;
    const [ux, uy, uz] = face.up;
    // Right = cross(up, dir)
    const rx = uy * dz - uz * dy;
    const ry = uz * dx - ux * dz;
    const rz = ux * dy - uy * dx;

    const corners = [
      [-1, -1], [1, -1], [1, 1], [-1, 1],
    ];

    const baseIndex = faceIndex * 4;

    corners.forEach(([cu, cv]) => {
      const px = dx + rx * cu + ux * cv;
      const py = dy + ry * cu + uy * cv;
      const pz = dz + rz * cu + uz * cv;

      positions.push(px, py, pz);
      normals.push(dx, dy, dz);
    });

    indices.push(
      baseIndex, baseIndex + 1, baseIndex + 2,
      baseIndex, baseIndex + 2, baseIndex + 3
    );
  });

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
  };
}

// ============================================================================
// WebGPU Renderer
// ============================================================================

export interface RendererConfig {
  canvas: HTMLCanvasElement;
  device: GPUDevice;
  bodyBuffer: GPUBuffer;
  maxBodies: number;
}

export class SdfPhysicsRenderer {
  private device: GPUDevice;
  private context: GPUCanvasContext;
  private format: GPUTextureFormat;

  // Buffers
  private cameraBuffer: GPUBuffer;
  private cameraBufferSphere: GPUBuffer;
  private cameraBufferBox: GPUBuffer;
  private sphereVertexBuffer: GPUBuffer;
  private sphereIndexBuffer: GPUBuffer;
  private sphereIndexCount: number;
  private boxVertexBuffer: GPUBuffer;
  private boxIndexBuffer: GPUBuffer;
  private boxIndexCount: number;

  // External body buffer reference
  private bodyBuffer: GPUBuffer;
  private maxBodies: number;

  // Pipelines
  private instancePipeline: GPURenderPipeline | null = null;
  private groundPipeline: GPURenderPipeline | null = null;
  private sdfVisPipeline: GPURenderPipeline | null = null;

  // Bind groups
  private instanceBindGroupSphere: GPUBindGroup | null = null;
  private instanceBindGroupBox: GPUBindGroup | null = null;
  private groundBindGroup: GPUBindGroup | null = null;
  private sdfVisBindGroup: GPUBindGroup | null = null;

  // SDF visualization
  private sdfUniformBuffer: GPUBuffer | null = null;
  private sdfVisualizationEnabled = false;
  private sdfTexture: GPUTexture | null = null;
  private sdfSampler: GPUSampler | null = null;
  private sdfVisBindGroupLayout: GPUBindGroupLayout | null = null;

  // Depth
  private depthTexture: GPUTexture | null = null;

  // Camera state
  camera: Camera;

  constructor(config: RendererConfig) {
    this.device = config.device;
    this.bodyBuffer = config.bodyBuffer;
    this.maxBodies = config.maxBodies;

    // Initialize WebGPU context
    this.context = config.canvas.getContext("webgpu")!;
    this.format = navigator.gpu.getPreferredCanvasFormat();

    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: "premultiplied",
    });

    // Create camera buffers (one for ground, one per geometry type)
    this.cameraBuffer = this.device.createBuffer({
      label: "Camera Uniform Buffer (Ground)",
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.cameraBufferSphere = this.device.createBuffer({
      label: "Camera Uniform Buffer (Sphere)",
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.cameraBufferBox = this.device.createBuffer({
      label: "Camera Uniform Buffer (Box)",
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create geometries
    const sphere = createSphereGeometry(16, 12);
    const box = createBoxGeometry();

    // Sphere buffers
    this.sphereVertexBuffer = this.createVertexBuffer(sphere.positions, sphere.normals);
    this.sphereIndexBuffer = this.createIndexBuffer(sphere.indices);
    this.sphereIndexCount = sphere.indices.length;

    // Box buffers
    this.boxVertexBuffer = this.createVertexBuffer(box.positions, box.normals);
    this.boxIndexBuffer = this.createIndexBuffer(box.indices);
    this.boxIndexCount = box.indices.length;

    // Initialize camera
    this.camera = {
      position: [0, 15, 30],
      target: [0, 0, 0],
      up: [0, 1, 0],
      fov: Math.PI / 3,
      aspect: config.canvas.width / config.canvas.height,
      near: 0.1,
      far: 1000,
    };

    this.initPipelines();
  }

  private createVertexBuffer(positions: Float32Array, normals: Float32Array): GPUBuffer {
    // Interleave positions and normals
    const vertexCount = positions.length / 3;
    const data = new Float32Array(vertexCount * 6);

    for (let i = 0; i < vertexCount; i++) {
      data[i * 6 + 0] = positions[i * 3 + 0];
      data[i * 6 + 1] = positions[i * 3 + 1];
      data[i * 6 + 2] = positions[i * 3 + 2];
      data[i * 6 + 3] = normals[i * 3 + 0];
      data[i * 6 + 4] = normals[i * 3 + 1];
      data[i * 6 + 5] = normals[i * 3 + 2];
    }

    const buffer = this.device.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    this.device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  }

  private createIndexBuffer(indices: Uint16Array): GPUBuffer {
    const buffer = this.device.createBuffer({
      size: indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });

    this.device.queue.writeBuffer(buffer, 0, indices);
    return buffer;
  }

  private initPipelines(): void {
    // Instance render pipeline
    const instanceShaderModule = this.device.createShaderModule({
      label: "Instance Shader",
      code: instanceShader,
    });

    const bindGroupLayout = this.device.createBindGroupLayout({
      label: "Instance Bind Group Layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "read-only-storage" },
        },
      ],
    });

    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });

    this.instancePipeline = this.device.createRenderPipeline({
      label: "Instance Render Pipeline",
      layout: pipelineLayout,
      vertex: {
        module: instanceShaderModule,
        entryPoint: "vs_main",
        buffers: [
          {
            arrayStride: 24, // 6 floats
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x3" }, // position
              { shaderLocation: 1, offset: 12, format: "float32x3" }, // normal
            ],
          },
        ],
      },
      fragment: {
        module: instanceShaderModule,
        entryPoint: "fs_main",
        targets: [{ format: this.format }],
      },
      primitive: {
        topology: "triangle-list",
        cullMode: "back",
      },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: true,
        depthCompare: "less",
      },
    });

    // Create separate bind groups for each geometry type
    this.instanceBindGroupSphere = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.cameraBufferSphere } },
        { binding: 1, resource: { buffer: this.bodyBuffer } },
      ],
    });

    this.instanceBindGroupBox = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.cameraBufferBox } },
        { binding: 1, resource: { buffer: this.bodyBuffer } },
      ],
    });

    // Ground plane pipeline
    const groundShaderModule = this.device.createShaderModule({
      label: "Ground Shader",
      code: groundPlaneShader,
    });

    const groundBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
      ],
    });

    this.groundPipeline = this.device.createRenderPipeline({
      label: "Ground Render Pipeline",
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [groundBindGroupLayout],
      }),
      vertex: {
        module: groundShaderModule,
        entryPoint: "vs_main",
      },
      fragment: {
        module: groundShaderModule,
        entryPoint: "fs_main",
        targets: [{
          format: this.format,
          blend: {
            color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
            alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
          },
        }],
      },
      primitive: {
        topology: "triangle-list",
      },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: true,
        depthCompare: "less",
      },
    });

    this.groundBindGroup = this.device.createBindGroup({
      layout: groundBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.cameraBuffer } },
      ],
    });
  }

  /**
   * Set up SDF visualization (call after SDF is created)
   */
  setupSdfVisualization(
    sdfTexture: GPUTexture,
    sdfSampler: GPUSampler,
    worldToSdf: Float32Array,
    sdfMin: [number, number, number],
    sdfMax: [number, number, number]
  ): void {
    // Store references for bind group recreation
    this.sdfTexture = sdfTexture;
    this.sdfSampler = sdfSampler;

    // Create SDF uniform buffer (only once)
    if (!this.sdfUniformBuffer) {
      this.sdfUniformBuffer = this.device.createBuffer({
        label: "SDF Uniform Buffer",
        size: 128, // 4x4 matrix + 2 vec4s
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
    }

    // Write SDF uniforms
    const sdfData = new Float32Array(32);
    sdfData.set(worldToSdf, 0); // worldToSdf matrix
    sdfData[16] = sdfMin[0];
    sdfData[17] = sdfMin[1];
    sdfData[18] = sdfMin[2];
    sdfData[19] = 0; // pad
    sdfData[20] = sdfMax[0];
    sdfData[21] = sdfMax[1];
    sdfData[22] = sdfMax[2];
    sdfData[23] = 0; // pad
    this.device.queue.writeBuffer(this.sdfUniformBuffer, 0, sdfData);

    // Create bind group layout (only once)
    if (!this.sdfVisBindGroupLayout) {
      this.sdfVisBindGroupLayout = this.device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: "uniform" },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.FRAGMENT,
            buffer: { type: "uniform" },
          },
          {
            binding: 2,
            visibility: GPUShaderStage.FRAGMENT,
            texture: { sampleType: "unfilterable-float", viewDimension: "3d" },
          },
          {
            binding: 3,
            visibility: GPUShaderStage.FRAGMENT,
            sampler: { type: "non-filtering" },
          },
          {
            binding: 4,
            visibility: GPUShaderStage.FRAGMENT,
            texture: { sampleType: "depth" },
          },
        ],
      });
    }

    // Create SDF visualization pipeline (only once)
    if (!this.sdfVisPipeline) {
      const sdfVisModule = this.device.createShaderModule({
        label: "SDF Visualizer Shader",
        code: sdfVisualizerShader,
      });

      this.sdfVisPipeline = this.device.createRenderPipeline({
        label: "SDF Visualization Pipeline",
        layout: this.device.createPipelineLayout({
          bindGroupLayouts: [this.sdfVisBindGroupLayout],
        }),
        vertex: {
          module: sdfVisModule,
          entryPoint: "vs_main",
        },
        fragment: {
          module: sdfVisModule,
          entryPoint: "fs_main",
          targets: [{
            format: this.format,
            blend: {
              color: {
                srcFactor: "src-alpha",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
              alpha: {
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
            },
          }],
        },
        primitive: {
          topology: "triangle-list",
        },
      });
    }

    // Try to create bind group now if depth texture is ready
    if (this.depthTexture) {
      this.recreateSdfVisBindGroup();
    }
  }

  /**
   * Recreate SDF visualization bind group (needed when depth texture changes)
   */
  private recreateSdfVisBindGroup(): void {
    if (!this.sdfVisBindGroupLayout || !this.sdfUniformBuffer || 
        !this.sdfTexture || !this.sdfSampler || !this.depthTexture) {
      return;
    }

    // Get depth texture dimensions to validate
    const depthSize = this.depthTexture.width;
    if (depthSize === 0) {
      return; // Wait for valid depth texture
    }

    this.sdfVisBindGroup = this.device.createBindGroup({
      layout: this.sdfVisBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.cameraBuffer } },
        { binding: 1, resource: { buffer: this.sdfUniformBuffer } },
        { binding: 2, resource: this.sdfTexture.createView() },
        { binding: 3, resource: this.sdfSampler },
        { binding: 4, resource: this.depthTexture.createView() },
      ],
    });
  }

  /**
   * Toggle SDF visualization mode
   */
  setSdfVisualizationEnabled(enabled: boolean): void {
    this.sdfVisualizationEnabled = enabled;
  }

  /**
   * Get SDF visualization mode state
   */
  isSdfVisualizationEnabled(): boolean {
    return this.sdfVisualizationEnabled;
  }

  /**
   * Resize the renderer
   */
  resize(width: number, height: number): void {
    // Skip invalid dimensions
    if (width <= 0 || height <= 0) {
      return;
    }

    this.camera.aspect = width / height;

    // Recreate depth texture
    if (this.depthTexture) {
      this.depthTexture.destroy();
    }

    this.depthTexture = this.device.createTexture({
      size: [width, height],
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    // Recreate SDF bind group with new depth texture
    this.recreateSdfVisBindGroup();
  }

  /**
   * Update camera uniforms for all buffers
   */
  private updateAllCameraBuffers(): void {
    const view = createViewMatrix(this.camera);
    const proj = createProjectionMatrix(this.camera);
    const viewProj = multiplyMatrices(proj, view);

    // Ground buffer (geometryType doesn't matter)
    const groundData = new Float32Array(64);
    groundData.set(view, 0);
    groundData.set(proj, 16);
    groundData.set(viewProj, 32);
    groundData[48] = this.camera.position[0];
    groundData[49] = this.camera.position[1];
    groundData[50] = this.camera.position[2];
    groundData[51] = 0;
    this.device.queue.writeBuffer(this.cameraBuffer, 0, groundData);

    // Sphere buffer (geometryType = 0)
    const sphereData = new Float32Array(64);
    sphereData.set(view, 0);
    sphereData.set(proj, 16);
    sphereData.set(viewProj, 32);
    sphereData[48] = this.camera.position[0];
    sphereData[49] = this.camera.position[1];
    sphereData[50] = this.camera.position[2];
    sphereData[51] = 0; // sphere geometry
    this.device.queue.writeBuffer(this.cameraBufferSphere, 0, sphereData);

    // Box buffer (geometryType = 1)
    const boxData = new Float32Array(64);
    boxData.set(view, 0);
    boxData.set(proj, 16);
    boxData.set(viewProj, 32);
    boxData[48] = this.camera.position[0];
    boxData[49] = this.camera.position[1];
    boxData[50] = this.camera.position[2];
    boxData[51] = 1; // box geometry
    this.device.queue.writeBuffer(this.cameraBufferBox, 0, boxData);
  }

  /**
   * Render a frame
   */
  render(totalBodies: number): void {
    if (!this.instancePipeline || !this.groundPipeline) return;
    if (!this.depthTexture) {
      // Initialize depth texture on first render
      const canvas = this.context.canvas as HTMLCanvasElement;
      this.resize(canvas.width, canvas.height);
    }

    // Update all camera buffers before rendering
    this.updateAllCameraBuffers();

    const commandEncoder = this.device.createCommandEncoder();
    const textureView = this.context.getCurrentTexture().createView();

    // ========================================================================
    // Pass 1: Render normal scene with depth
    // ========================================================================
    const scenePass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0.1, g: 0.1, b: 0.15, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: this.depthTexture!.createView(),
        depthClearValue: 1.0,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });

    // Render terrain (64x64 grid = 4096 quads = 8192 triangles = 24576 vertices)
    scenePass.setPipeline(this.groundPipeline);
    scenePass.setBindGroup(0, this.groundBindGroup!);
    scenePass.draw(24576);

    // Render bodies as instanced geometry
    if (totalBodies > 0) {
      scenePass.setPipeline(this.instancePipeline);

      // First pass: render balls with sphere geometry
      scenePass.setBindGroup(0, this.instanceBindGroupSphere!);
      scenePass.setVertexBuffer(0, this.sphereVertexBuffer);
      scenePass.setIndexBuffer(this.sphereIndexBuffer, "uint16");
      scenePass.drawIndexed(this.sphereIndexCount, totalBodies);

      // Second pass: render boxes with box geometry
      scenePass.setBindGroup(0, this.instanceBindGroupBox!);
      scenePass.setVertexBuffer(0, this.boxVertexBuffer);
      scenePass.setIndexBuffer(this.boxIndexBuffer, "uint16");
      scenePass.drawIndexed(this.boxIndexCount, totalBodies);
    }

    scenePass.end();

    // ========================================================================
    // Pass 2: SDF Visualization overlay (if enabled)
    // ========================================================================
    if (this.sdfVisualizationEnabled && this.sdfVisPipeline) {
      // Ensure bind group exists (may need to create after depth texture is ready)
      if (!this.sdfVisBindGroup) {
        this.recreateSdfVisBindGroup();
      }
    }
    
    if (this.sdfVisualizationEnabled && this.sdfVisPipeline && this.sdfVisBindGroup) {
      const overlayPass = commandEncoder.beginRenderPass({
        colorAttachments: [
          {
            view: textureView,
            loadOp: "load", // Preserve the scene we just rendered
            storeOp: "store",
          },
        ],
      });

      overlayPass.setPipeline(this.sdfVisPipeline);
      overlayPass.setBindGroup(0, this.sdfVisBindGroup);
      overlayPass.draw(3); // Fullscreen triangle

      overlayPass.end();
    }

    this.device.queue.submit([commandEncoder.finish()]);
  }

  /**
   * Update the body buffer reference (for when physics world is recreated)
   */
  updateBodyBuffer(newBodyBuffer: GPUBuffer): void {
    this.bodyBuffer = newBodyBuffer;

    // Recreate bind groups with new buffer
    if (this.instancePipeline) {
      const bindGroupLayout = this.instancePipeline.getBindGroupLayout(0);

      this.instanceBindGroupSphere = this.device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.cameraBufferSphere } },
          { binding: 1, resource: { buffer: this.bodyBuffer } },
        ],
      });

      this.instanceBindGroupBox = this.device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.cameraBufferBox } },
          { binding: 1, resource: { buffer: this.bodyBuffer } },
        ],
      });
    }
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.cameraBuffer.destroy();
    this.cameraBufferSphere.destroy();
    this.cameraBufferBox.destroy();
    this.sphereVertexBuffer.destroy();
    this.sphereIndexBuffer.destroy();
    this.boxVertexBuffer.destroy();
    this.boxIndexBuffer.destroy();
    this.depthTexture?.destroy();
    this.sdfUniformBuffer?.destroy();
  }
}




