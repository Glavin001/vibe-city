/**
 * WebGPU SDF Upload Utilities
 *
 * Uploads baked SDF data to WebGPU 3D textures for GPU-based collision detection.
 */

import * as THREE from "three";
import type { BakedSDF } from "./sdf-bake";

export interface GpuSdf {
  /** 3D texture containing SDF data */
  texture: GPUTexture;
  /** Sampler for the SDF texture */
  sampler: GPUSampler;
  /** World-to-SDF transform matrix (column-major Float32Array) */
  worldToSdf: Float32Array;
  /** SDF-to-World transform matrix */
  sdfToWorld: Float32Array;
  /** Resolution of the SDF */
  dim: number;
}

/**
 * Upload a BakedSDF to WebGPU as a 3D texture
 */
export function uploadSdfToWebGPU(
  device: GPUDevice,
  bakedSdf: BakedSDF
): GpuSdf {
  const { dim, data, worldToSdf, sdfToWorld } = bakedSdf;

  // Create 3D texture
  const texture = device.createTexture({
    label: "SDF 3D Texture",
    size: [dim, dim, dim],
    format: "r32float",
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.STORAGE_BINDING,
    dimension: "3d",
  });

  // Write SDF data to texture
  device.queue.writeTexture(
    { texture },
    data,
    {
      bytesPerRow: dim * 4,
      rowsPerImage: dim,
    },
    { width: dim, height: dim, depthOrArrayLayers: dim }
  );

  // Create sampler (non-filtering for r32float textures on most GPUs)
  const sampler = device.createSampler({
    label: "SDF Sampler",
    magFilter: "nearest",
    minFilter: "nearest",
    mipmapFilter: "nearest",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
    addressModeW: "clamp-to-edge",
  });

  // Convert matrices to Float32Array (column-major for WebGPU/WGSL)
  const worldToSdfArray = new Float32Array(16);
  const sdfToWorldArray = new Float32Array(16);
  worldToSdf.toArray(worldToSdfArray);
  sdfToWorld.toArray(sdfToWorldArray);

  return {
    texture,
    sampler,
    worldToSdf: worldToSdfArray,
    sdfToWorld: sdfToWorldArray,
    dim,
  };
}

/**
 * Create a uniform buffer containing SDF parameters
 */
export function createSdfUniformBuffer(
  device: GPUDevice,
  gpuSdf: GpuSdf,
  extraUniforms?: {
    dt?: number;
    gravity?: number;
    numBodies?: number;
  }
): GPUBuffer {
  // Layout: worldToSdf (64 bytes) + sdfToWorld (64 bytes) + params (16 bytes)
  // params: [dt, gravity, numBodies, dim]
  const bufferSize = 64 + 64 + 16;

  const buffer = device.createBuffer({
    label: "SDF Uniform Buffer",
    size: bufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  updateSdfUniformBuffer(device, buffer, gpuSdf, extraUniforms);

  return buffer;
}

/**
 * Update the SDF uniform buffer with new values
 */
export function updateSdfUniformBuffer(
  device: GPUDevice,
  buffer: GPUBuffer,
  gpuSdf: GpuSdf,
  extraUniforms?: {
    dt?: number;
    gravity?: number;
    numBodies?: number;
  }
): void {
  const data = new ArrayBuffer(64 + 64 + 16);
  const f32 = new Float32Array(data);
  const u32 = new Uint32Array(data);

  // worldToSdf matrix (0-15)
  f32.set(gpuSdf.worldToSdf, 0);

  // sdfToWorld matrix (16-31)
  f32.set(gpuSdf.sdfToWorld, 16);

  // params (32-35)
  f32[32] = extraUniforms?.dt ?? 1 / 60;
  f32[33] = extraUniforms?.gravity ?? 9.8;
  u32[34] = extraUniforms?.numBodies ?? 0;
  u32[35] = gpuSdf.dim;

  device.queue.writeBuffer(buffer, 0, data);
}

/**
 * Create bind group layout for SDF resources
 */
export function createSdfBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
  return device.createBindGroupLayout({
    label: "SDF Bind Group Layout",
    entries: [
      {
        // SDF 3D texture
        binding: 0,
        visibility: GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
        texture: {
          sampleType: "unfilterable-float",
          viewDimension: "3d",
        },
      },
      {
        // SDF sampler
        binding: 1,
        visibility: GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
        sampler: { type: "non-filtering" },
      },
      {
        // Uniforms
        binding: 2,
        visibility: GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
    ],
  });
}

/**
 * Create bind group for SDF resources
 */
export function createSdfBindGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  gpuSdf: GpuSdf,
  uniformBuffer: GPUBuffer
): GPUBindGroup {
  return device.createBindGroup({
    label: "SDF Bind Group",
    layout,
    entries: [
      {
        binding: 0,
        resource: gpuSdf.texture.createView(),
      },
      {
        binding: 1,
        resource: gpuSdf.sampler,
      },
      {
        binding: 2,
        resource: { buffer: uniformBuffer },
      },
    ],
  });
}

/**
 * Dispose GPU resources
 */
export function disposeGpuSdf(gpuSdf: GpuSdf): void {
  gpuSdf.texture.destroy();
}




