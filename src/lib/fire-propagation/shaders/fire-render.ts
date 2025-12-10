/**
 * Fire Propagation Render Shader
 *
 * Vertex and fragment shaders for rendering the fire grid as instanced quads.
 * Uses TSL (Three.js Shading Language) for WebGPU compatibility.
 */

/**
 * Color palette for different fire states.
 */
export const FIRE_COLORS = {
  // Base colors (when not burning)
  grass: [0.29, 0.49, 0.14], // Green
  dryBrush: [0.55, 0.45, 0.33], // Tan
  wood: [0.55, 0.27, 0.07], // Brown
  leaves: [0.13, 0.55, 0.13], // Forest green
  stone: [0.5, 0.5, 0.5], // Gray
  water: [0.25, 0.41, 0.88], // Blue
  lava: [1.0, 0.27, 0.0], // Orange-red

  // Fire gradient (by temperature)
  fireCore: [1.0, 0.95, 0.5], // Bright yellow-white
  fireMid: [1.0, 0.5, 0.0], // Orange
  fireOuter: [0.8, 0.15, 0.0], // Deep red

  // State colors
  charred: [0.1, 0.08, 0.05], // Almost black
  wet: [0.15, 0.35, 0.55], // Dark blue tint
  steam: [0.9, 0.9, 0.95], // White-ish
  frozen: [0.7, 0.85, 0.95], // Light blue
  smoldering: [0.4, 0.2, 0.1], // Dark red-brown
};

/**
 * WGSL shader for rendering fire grid as instanced geometry.
 */
export const fireRenderShader = /* wgsl */ `

// ============================================================================
// Vertex Shader Inputs
// ============================================================================

struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
  @builtin(instance_index) instanceIndex: u32,
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
  @location(3) temperature: f32,
  @location(4) moisture: f32,
  @location(5) fuel: f32,
  @location(6) @interpolate(flat) materialId: u32,
}

// ============================================================================
// Uniforms
// ============================================================================

struct CameraUniforms {
  viewProjection: mat4x4<f32>,
  cameraPosition: vec3<f32>,
  time: f32,
}

struct GridUniforms {
  gridSize: vec4<u32>,     // x, y, z, total
  origin: vec3<f32>,
  voxelSize: f32,
}

@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(0) @binding(1) var<uniform> grid: GridUniforms;
@group(0) @binding(2) var<storage, read> voxelState: array<u32>;

// ============================================================================
// Utility Functions
// ============================================================================

fn unpackVoxel(packed: u32) -> vec4<u32> {
  return vec4<u32>(
    packed & 0xFFu,
    (packed >> 8u) & 0xFFu,
    (packed >> 16u) & 0xFFu,
    (packed >> 24u) & 0xFFu
  );
}

fn indexToCoords(index: u32) -> vec3<u32> {
  let sizeX = grid.gridSize.x;
  let sizeXY = sizeX * grid.gridSize.y;
  let z = index / sizeXY;
  let remainder = index % sizeXY;
  let y = remainder / sizeX;
  let x = remainder % sizeX;
  return vec3<u32>(x, y, z);
}

fn hash11(p: f32) -> f32 {
  var p2 = fract(p * 0.1031);
  p2 *= p2 + 33.33;
  p2 *= p2 + p2;
  return fract(p2);
}

// ============================================================================
// Vertex Shader
// ============================================================================

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  
  // Get voxel data for this instance
  let voxelData = voxelState[input.instanceIndex];
  let unpacked = unpackVoxel(voxelData);
  
  let temperature = f32(unpacked.x) / 255.0;
  let moisture = f32(unpacked.y) / 255.0;
  let fuel = f32(unpacked.z) / 255.0;
  let materialId = unpacked.w;
  
  // Skip air voxels (material 0) - move them far away
  if (materialId == 0u) {
    output.position = vec4<f32>(0.0, -10000.0, 0.0, 1.0);
    return output;
  }
  
  // Calculate world position from instance index
  let coords = indexToCoords(input.instanceIndex);
  let voxelCenter = grid.origin + vec3<f32>(
    f32(coords.x) + 0.5,
    f32(coords.y) + 0.5,
    f32(coords.z) + 0.5
  ) * grid.voxelSize;
  
  // Scale and offset the vertex position
  var localPos = input.position * grid.voxelSize * 0.5;
  
  // Add some vertex displacement for burning voxels (flickering)
  let isBurning = temperature > 0.4 && moisture < 0.3 && fuel > 0.0;
  if (isBurning) {
    let noiseInput = voxelCenter + vec3<f32>(camera.time * 5.0, 0.0, 0.0);
    let displacement = hash11(dot(noiseInput, vec3<f32>(12.9898, 78.233, 45.164))) * 0.1;
    localPos.y += displacement * temperature;
  }
  
  let worldPos = voxelCenter + localPos;
  
  output.position = camera.viewProjection * vec4<f32>(worldPos, 1.0);
  output.worldPos = worldPos;
  output.normal = input.normal;
  output.uv = input.uv;
  output.temperature = temperature;
  output.moisture = moisture;
  output.fuel = fuel;
  output.materialId = materialId;
  
  return output;
}

// ============================================================================
// Fragment Shader
// ============================================================================

// Material base colors
fn getMaterialColor(materialId: u32) -> vec3<f32> {
  switch (materialId) {
    case 1u: { return vec3<f32>(0.29, 0.49, 0.14); } // Grass
    case 2u: { return vec3<f32>(0.55, 0.45, 0.33); } // Dry brush
    case 3u: { return vec3<f32>(0.55, 0.27, 0.07); } // Wood
    case 4u: { return vec3<f32>(0.13, 0.55, 0.13); } // Leaves
    case 5u: { return vec3<f32>(0.5, 0.5, 0.5); }    // Stone
    case 6u: { return vec3<f32>(0.25, 0.41, 0.88); } // Water
    case 7u: { return vec3<f32>(1.0, 0.27, 0.0); }   // Lava
    default: { return vec3<f32>(0.5, 0.5, 0.5); }
  }
}

// Fire color gradient
fn getFireColor(intensity: f32) -> vec3<f32> {
  let fireCore = vec3<f32>(1.0, 0.95, 0.5);
  let fireMid = vec3<f32>(1.0, 0.5, 0.0);
  let fireOuter = vec3<f32>(0.8, 0.15, 0.0);
  
  if (intensity > 0.7) {
    return mix(fireMid, fireCore, (intensity - 0.7) / 0.3);
  } else if (intensity > 0.3) {
    return mix(fireOuter, fireMid, (intensity - 0.3) / 0.4);
  } else {
    return fireOuter * intensity / 0.3;
  }
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let baseColor = getMaterialColor(input.materialId);
  
  var finalColor = baseColor;
  var emissive = vec3<f32>(0.0);
  
  // Determine visual state
  let isBurning = input.temperature > 0.4 && input.moisture < 0.3 && input.fuel > 0.0;
  let isSteaming = input.temperature > 0.5 && input.moisture > 0.4;
  let isCharred = input.fuel <= 0.01 && input.materialId != 5u && input.materialId != 6u; // Not stone or water
  let isWet = input.moisture > 0.5;
  let isSmoldering = input.temperature > 0.3 && input.moisture < 0.4 && !isBurning;
  
  // Apply visual states
  if (isCharred) {
    // Charred - dark black
    finalColor = vec3<f32>(0.1, 0.08, 0.05);
  } else if (isBurning) {
    // Burning - fire color with animation
    let fireIntensity = input.temperature * (1.0 - input.moisture);
    let flicker = hash11(camera.time * 10.0 + dot(input.worldPos, vec3<f32>(1.0))) * 0.2 + 0.8;
    emissive = getFireColor(fireIntensity) * flicker * 2.0;
    finalColor = mix(baseColor, vec3<f32>(0.2, 0.1, 0.05), input.temperature);
  } else if (isSteaming) {
    // Steaming - white tint
    finalColor = mix(baseColor, vec3<f32>(0.9, 0.9, 0.95), input.moisture * 0.5);
    emissive = vec3<f32>(0.3, 0.3, 0.35) * input.temperature;
  } else if (isSmoldering) {
    // Smoldering - slight red glow
    emissive = vec3<f32>(0.5, 0.1, 0.0) * input.temperature * 0.5;
    finalColor = mix(baseColor, vec3<f32>(0.3, 0.15, 0.1), input.temperature * 0.3);
  } else if (isWet) {
    // Wet - darker, bluer tint
    finalColor = mix(baseColor, vec3<f32>(0.15, 0.25, 0.4), input.moisture * 0.3);
  }
  
  // Lava special case
  if (input.materialId == 7u) {
    emissive = vec3<f32>(1.0, 0.4, 0.0) * 2.0;
    finalColor = vec3<f32>(0.8, 0.2, 0.0);
  }
  
  // Water special case
  if (input.materialId == 6u) {
    finalColor = vec3<f32>(0.2, 0.4, 0.8);
    // Add some shimmer
    let shimmer = hash11(camera.time + dot(input.worldPos.xz, vec2<f32>(1.0))) * 0.1;
    finalColor += vec3<f32>(shimmer);
  }
  
  // Simple lighting
  let lightDir = normalize(vec3<f32>(0.5, 1.0, 0.3));
  let ambient = 0.3;
  let diffuse = max(dot(input.normal, lightDir), 0.0) * 0.7;
  let lighting = ambient + diffuse;
  
  finalColor = finalColor * lighting + emissive;
  
  // Gamma correction
  finalColor = pow(finalColor, vec3<f32>(1.0 / 2.2));
  
  return vec4<f32>(finalColor, 1.0);
}
`;

/**
 * Simple vertex shader for non-instanced ground plane.
 */
export const groundPlaneShader = /* wgsl */ `

struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) uv: vec2<f32>,
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) worldPos: vec3<f32>,
}

struct Uniforms {
  viewProjection: mat4x4<f32>,
  cameraPosition: vec3<f32>,
  time: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.position = uniforms.viewProjection * vec4<f32>(input.position, 1.0);
  output.uv = input.uv;
  output.worldPos = input.position;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  // Checkerboard pattern
  let gridSize = 10.0;
  let checker = floor(input.worldPos.x / gridSize) + floor(input.worldPos.z / gridSize);
  let pattern = fract(checker * 0.5) * 2.0;
  
  let color1 = vec3<f32>(0.15, 0.15, 0.18);
  let color2 = vec3<f32>(0.2, 0.2, 0.23);
  let color = mix(color1, color2, pattern);
  
  return vec4<f32>(color, 1.0);
}
`;

