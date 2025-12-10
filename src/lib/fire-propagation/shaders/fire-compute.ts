/**
 * Fire Propagation GPU Compute Shader (WGSL)
 *
 * Simulates fire propagation on a 3D voxel grid using WebGPU compute shaders.
 * Each voxel stores: temperature, moisture, fuel, materialId (4 bytes total).
 */

export const fireComputeShader = /* wgsl */ `

// ============================================================================
// Structures
// ============================================================================

struct SimulationUniforms {
  // vec4: gridSizeX, gridSizeY, gridSizeZ, totalVoxels
  gridSize: vec4<u32>,
  // vec4: voxelSize, deltaTime, time, timeScale
  simParams: vec4<f32>,
  // vec4: windDirX, windDirZ, windSpeed, turbulence
  wind: vec4<f32>,
  // vec4: ambientTemp, ambientHumidity, convectionStrength, radiantHeatRange
  environment: vec4<f32>,
}

// Material properties - 8 floats per material (2 vec4s), 8 materials = 64 floats
struct MaterialProperties {
  // vec4: ignitionTemp, maxBurnMoisture, burnRate, heatConductivity
  thermal: vec4<f32>,
  // vec4: moistureCapacity, evaporationRate, maxFuel, flammability
  combustion: vec4<f32>,
}

// ============================================================================
// Bindings
// ============================================================================

@group(0) @binding(0) var<uniform> uniforms: SimulationUniforms;
@group(0) @binding(1) var<storage, read> materialsIn: array<MaterialProperties>;
@group(0) @binding(2) var<storage, read> stateIn: array<u32>;
@group(0) @binding(3) var<storage, read_write> stateOut: array<u32>;

// ============================================================================
// Constants
// ============================================================================

const MATERIAL_AIR: u32 = 0u;
const MATERIAL_GRASS: u32 = 1u;
const MATERIAL_DRY_BRUSH: u32 = 2u;
const MATERIAL_WOOD: u32 = 3u;
const MATERIAL_LEAVES: u32 = 4u;
const MATERIAL_STONE: u32 = 5u;
const MATERIAL_WATER: u32 = 6u;
const MATERIAL_LAVA: u32 = 7u;

const PI: f32 = 3.14159265359;

// ============================================================================
// Utility Functions
// ============================================================================

// Pack 4 uint8 values into a single u32
fn packVoxel(temp: u32, moist: u32, fuel: u32, mat: u32) -> u32 {
  return (temp & 0xFFu) | ((moist & 0xFFu) << 8u) | ((fuel & 0xFFu) << 16u) | ((mat & 0xFFu) << 24u);
}

// Unpack u32 into 4 uint8 values
fn unpackVoxel(packed: u32) -> vec4<u32> {
  return vec4<u32>(
    packed & 0xFFu,
    (packed >> 8u) & 0xFFu,
    (packed >> 16u) & 0xFFu,
    (packed >> 24u) & 0xFFu
  );
}

// Convert 3D coordinates to flat index
fn coordsToIndex(x: u32, y: u32, z: u32) -> u32 {
  let sizeX = uniforms.gridSize.x;
  let sizeY = uniforms.gridSize.y;
  return x + y * sizeX + z * sizeX * sizeY;
}

// Check if coordinates are in bounds
fn inBounds(x: i32, y: i32, z: i32) -> bool {
  let sizeX = i32(uniforms.gridSize.x);
  let sizeY = i32(uniforms.gridSize.y);
  let sizeZ = i32(uniforms.gridSize.z);
  return x >= 0 && x < sizeX && y >= 0 && y < sizeY && z >= 0 && z < sizeZ;
}

// Simple hash for pseudo-random numbers
fn hash(p: vec3<u32>) -> f32 {
  var h = p.x * 374761393u + p.y * 668265263u + p.z * 1013904223u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h = h ^ (h >> 16u);
  return f32(h & 0xFFFFFFu) / f32(0xFFFFFF);
}

// Get material properties (clamped index)
fn getMaterial(materialId: u32) -> MaterialProperties {
  let idx = min(materialId, 7u);
  return materialsIn[idx];
}

// ============================================================================
// Noise Functions for Turbulence
// ============================================================================

fn noise3D(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  
  let ix = u32(i.x) & 0xFFu;
  let iy = u32(i.y) & 0xFFu;
  let iz = u32(i.z) & 0xFFu;
  
  let n000 = hash(vec3<u32>(ix, iy, iz));
  let n100 = hash(vec3<u32>(ix + 1u, iy, iz));
  let n010 = hash(vec3<u32>(ix, iy + 1u, iz));
  let n110 = hash(vec3<u32>(ix + 1u, iy + 1u, iz));
  let n001 = hash(vec3<u32>(ix, iy, iz + 1u));
  let n101 = hash(vec3<u32>(ix + 1u, iy, iz + 1u));
  let n011 = hash(vec3<u32>(ix, iy + 1u, iz + 1u));
  let n111 = hash(vec3<u32>(ix + 1u, iy + 1u, iz + 1u));
  
  let nx00 = mix(n000, n100, u.x);
  let nx10 = mix(n010, n110, u.x);
  let nx01 = mix(n001, n101, u.x);
  let nx11 = mix(n011, n111, u.x);
  
  let nxy0 = mix(nx00, nx10, u.y);
  let nxy1 = mix(nx01, nx11, u.y);
  
  return mix(nxy0, nxy1, u.z);
}

// ============================================================================
// Main Simulation Step
// ============================================================================

@compute @workgroup_size(8, 8, 4)
fn simulateStep(@builtin(global_invocation_id) gid: vec3<u32>) {
  let sizeX = uniforms.gridSize.x;
  let sizeY = uniforms.gridSize.y;
  let sizeZ = uniforms.gridSize.z;
  
  // Bounds check
  if (gid.x >= sizeX || gid.y >= sizeY || gid.z >= sizeZ) {
    return;
  }
  
  let idx = coordsToIndex(gid.x, gid.y, gid.z);
  let packed = stateIn[idx];
  let voxel = unpackVoxel(packed);
  
  // Extract current state (normalized 0-1)
  var temp = f32(voxel.x) / 255.0;
  var moist = f32(voxel.y) / 255.0;
  var fuel = f32(voxel.z) / 255.0;
  let materialId = voxel.w;
  
  // Get material properties
  let mat = getMaterial(materialId);
  
  // Skip air voxels (just copy through)
  if (materialId == MATERIAL_AIR) {
    stateOut[idx] = packed;
    return;
  }
  
  // Extract simulation parameters
  let dt = uniforms.simParams.y * uniforms.simParams.w; // deltaTime * timeScale
  let time = uniforms.simParams.z;
  let windDirX = uniforms.wind.x;
  let windDirZ = uniforms.wind.y;
  let windSpeed = uniforms.wind.z;
  let turbulence = uniforms.wind.w;
  let ambientTemp = uniforms.environment.x;
  let ambientHumidity = uniforms.environment.y;
  let convectionStrength = uniforms.environment.z;
  
  // Material properties
  let ignitionTemp = mat.thermal.x;
  let maxBurnMoisture = mat.thermal.y;
  let burnRate = mat.thermal.z;
  let heatConductivity = mat.thermal.w;
  let moistureCapacity = mat.combustion.x;
  let evaporationRate = mat.combustion.y;
  let maxFuel = mat.combustion.z;
  let flammability = mat.combustion.w;
  
  // ========================================================================
  // Heat Transfer from Neighbors
  // ========================================================================
  var heatInflux = 0.0;
  var moistInflux = 0.0;
  
  let x = i32(gid.x);
  let y = i32(gid.y);
  let z = i32(gid.z);
  
  // Sample 26 neighbors (3x3x3 cube minus center)
  for (var dz = -1; dz <= 1; dz++) {
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        if (dx == 0 && dy == 0 && dz == 0) {
          continue;
        }
        
        let nx = x + dx;
        let ny = y + dy;
        let nz = z + dz;
        
        if (!inBounds(nx, ny, nz)) {
          continue;
        }
        
        let nIdx = coordsToIndex(u32(nx), u32(ny), u32(nz));
        let nPacked = stateIn[nIdx];
        let nVoxel = unpackVoxel(nPacked);
        let nTemp = f32(nVoxel.x) / 255.0;
        let nMoist = f32(nVoxel.y) / 255.0;
        let nMaterialId = nVoxel.w;
        let nMat = getMaterial(nMaterialId);
        
        // Distance factor (diagonals are further)
        let dist = sqrt(f32(dx * dx + dy * dy + dz * dz));
        let distFactor = 1.0 / dist;
        
        // Direction weight for convection (heat rises)
        var dirWeight = 1.0;
        if (dy < 0) {
          // Neighbor is below us - we receive more heat from below (convection)
          dirWeight = convectionStrength;
        }
        
        // Wind bias for horizontal propagation
        if (dy == 0) {
          let windDot = f32(dx) * windDirX + f32(dz) * windDirZ;
          // Add turbulence noise
          let noisePos = vec3<f32>(f32(gid.x), time * 0.5, f32(gid.z)) * 0.1;
          let turb = (noise3D(noisePos) - 0.5) * turbulence;
          dirWeight = 1.0 + (windDot + turb) * windSpeed * 2.0;
        }
        
        // Heat transfer based on temperature difference and conductivity
        let avgConductivity = (heatConductivity + nMat.thermal.w) * 0.5;
        let tempDiff = nTemp - temp;
        heatInflux += tempDiff * avgConductivity * dirWeight * distFactor * 0.1;
        
        // Moisture transfer from water sources
        if (nMaterialId == MATERIAL_WATER && moist < moistureCapacity) {
          moistInflux += 0.05 * distFactor;
        }
      }
    }
  }
  
  // Apply heat influx
  temp += heatInflux * dt;
  
  // ========================================================================
  // Combustion
  // ========================================================================
  let isBurning = temp > ignitionTemp && moist < maxBurnMoisture && fuel > 0.0 && flammability > 0.0;
  
  if (isBurning) {
    // Consume fuel
    fuel -= burnRate * dt * 0.1;
    fuel = max(0.0, fuel);
    
    // Burning generates heat
    temp += 0.3 * dt * flammability;
    
    // Burning evaporates moisture faster
    moist -= evaporationRate * dt * 2.0;
  }
  
  // ========================================================================
  // Heat Sources (Lava)
  // ========================================================================
  if (materialId == MATERIAL_LAVA) {
    temp = 1.0; // Always max temperature
  }
  
  // ========================================================================
  // Moisture Dynamics
  // ========================================================================
  // Moisture source (water)
  if (materialId == MATERIAL_WATER) {
    moist = 1.0;
  } else {
    // Evaporation when hot
    if (temp > 0.3 && moist > 0.0) {
      let evapRate = evaporationRate * (temp - 0.3) * dt;
      moist -= evapRate;
    }
    
    // Moisture influx from neighbors
    moist += moistInflux * dt;
    
    // Ambient humidity absorption (slow)
    if (moist < ambientHumidity) {
      moist += (ambientHumidity - moist) * 0.01 * dt;
    }
  }
  
  // ========================================================================
  // Cooling
  // ========================================================================
  if (materialId != MATERIAL_LAVA && !isBurning) {
    let coolRate = 0.1 * dt;
    temp += (ambientTemp - temp) * coolRate;
  }
  
  // Wet materials absorb heat (heat capacity)
  if (moist > 0.3) {
    let absorption = moist * 0.1 * dt;
    temp -= absorption * (temp - ambientTemp);
  }
  
  // ========================================================================
  // Clamp and Write Output
  // ========================================================================
  temp = clamp(temp, 0.0, 1.0);
  moist = clamp(moist, 0.0, moistureCapacity);
  fuel = clamp(fuel, 0.0, 1.0);
  
  let outPacked = packVoxel(
    u32(temp * 255.0),
    u32(moist * 255.0),
    u32(fuel * 255.0),
    materialId
  );
  
  stateOut[idx] = outPacked;
}
`;

/**
 * Material properties data for GPU upload.
 * Each material has 8 floats (2 vec4s).
 */
export function createMaterialPropertiesData(): Float32Array {
  // 8 materials × 8 floats = 64 floats
  return new Float32Array([
    // Air (0)
    1.0, 0.0, 0.0, 0.1,    // ignitionTemp, maxBurnMoisture, burnRate, heatConductivity
    0.0, 0.0, 0.0, 0.0,    // moistureCapacity, evaporationRate, maxFuel, flammability
    
    // Grass (1)
    0.35, 0.4, 0.8, 0.6,
    0.7, 0.5, 0.4, 1.2,
    
    // Dry Brush (2)
    0.25, 0.2, 1.5, 0.8,
    0.3, 1.0, 0.3, 2.0,
    
    // Wood (3)
    0.45, 0.35, 0.2, 0.4,
    0.5, 0.3, 1.0, 0.8,
    
    // Leaves (4)
    0.2, 0.3, 2.0, 0.7,
    0.6, 0.8, 0.2, 2.5,
    
    // Stone (5)
    1.0, 0.0, 0.0, 0.9,
    0.1, 0.1, 0.0, 0.0,
    
    // Water (6)
    1.0, 0.0, 0.0, 0.6,
    1.0, 0.0, 0.0, 0.0,
    
    // Lava (7)
    1.0, 0.0, 0.0, 1.0,
    0.0, 2.0, 1.0, 0.0,
  ]);
}

/**
 * Create simulation uniforms data.
 */
export function createSimulationUniformsData(
  gridSizeX: number,
  gridSizeY: number,
  gridSizeZ: number,
  voxelSize: number,
  deltaTime: number,
  time: number,
  timeScale: number,
  windDirX: number,
  windDirZ: number,
  windSpeed: number,
  turbulence: number,
  ambientTemp: number,
  ambientHumidity: number,
  convectionStrength: number,
  radiantHeatRange: number
): Float32Array {
  const totalVoxels = gridSizeX * gridSizeY * gridSizeZ;
  
  // Use Uint32Array view for integer values, then convert to Float32Array
  const data = new Float32Array(16);
  const uintView = new Uint32Array(data.buffer);
  
  // vec4: gridSize (as u32)
  uintView[0] = gridSizeX;
  uintView[1] = gridSizeY;
  uintView[2] = gridSizeZ;
  uintView[3] = totalVoxels;
  
  // vec4: simParams (as f32)
  data[4] = voxelSize;
  data[5] = deltaTime;
  data[6] = time;
  data[7] = timeScale;
  
  // vec4: wind (as f32)
  data[8] = windDirX;
  data[9] = windDirZ;
  data[10] = windSpeed;
  data[11] = turbulence;
  
  // vec4: environment (as f32)
  data[12] = ambientTemp;
  data[13] = ambientHumidity;
  data[14] = convectionStrength;
  data[15] = radiantHeatRange;
  
  return data;
}

