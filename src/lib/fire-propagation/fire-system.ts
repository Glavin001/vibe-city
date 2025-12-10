/**
 * Fire Propagation System - Core Simulation Logic
 *
 * CPU-based simulation for the fire propagation system.
 * Can be used standalone or as a reference for the GPU compute shader.
 */

import {
  type GridConfig,
  type WindParams,
  type SimulationParams,
  type SimulationStats,
  type VoxelState,
  type MaterialProperties,
  MaterialType,
  VisualState,
  MATERIAL_PROPERTIES,
  DEFAULT_WIND,
  DEFAULT_SIMULATION,
  GRID_PRESETS,
  type GridPreset,
} from "./types";

// ============================================================================
// Fire System Class
// ============================================================================

/**
 * Main fire propagation simulation system.
 * Manages the voxel grid and runs the simulation step.
 * Uses SPARSE tracking - only processes non-Air voxels for performance.
 */
export class FireSystem {
  // Grid configuration
  readonly config: GridConfig;
  readonly totalVoxels: number;

  // Double-buffered state arrays (read from one, write to other)
  private stateA: Uint8Array;
  private stateB: Uint8Array;
  private readBuffer: Uint8Array;
  private writeBuffer: Uint8Array;

  // Sparse tracking - only process/render non-Air voxels
  private activeIndices: Int32Array; // Flat indices of non-Air voxels
  private activeCount: number = 0; // Number of active voxels
  private isActive: Uint8Array; // O(1) lookup: is voxel at index active?

  // Simulation parameters
  wind: WindParams;
  simulation: SimulationParams;
  globalBurnRate: number = 1.0;
  globalFuel: number = 1.0;

  // Time tracking
  private time: number = 0;

  // Statistics
  private stats: SimulationStats;

  // Pre-computed neighbor offsets for 26-connectivity
  private neighborOffsets: Int32Array;
  // Pre-computed neighbor direction vectors (dx, dy, dz) for each of 26 neighbors
  private neighborDirections: Int8Array;

  constructor(
    preset: GridPreset = "medium",
    origin: [number, number, number] = [0, 0, 0]
  ) {
    const presetConfig = GRID_PRESETS[preset];
    this.config = {
      sizeX: presetConfig.sizeX,
      sizeY: presetConfig.sizeY,
      sizeZ: presetConfig.sizeZ,
      voxelSize: presetConfig.voxelSize,
      originX: origin[0],
      originY: origin[1],
      originZ: origin[2],
    };

    this.totalVoxels =
      this.config.sizeX * this.config.sizeY * this.config.sizeZ;

    // Each voxel = 4 bytes: temperature, moisture, fuel, materialId
    this.stateA = new Uint8Array(this.totalVoxels * 4);
    this.stateB = new Uint8Array(this.totalVoxels * 4);
    this.readBuffer = this.stateA;
    this.writeBuffer = this.stateB;

    // Initialize sparse tracking arrays
    this.activeIndices = new Int32Array(this.totalVoxels); // Max possible size
    this.isActive = new Uint8Array(this.totalVoxels); // O(1) lookup
    this.activeCount = 0;

    // Initialize default parameters
    this.wind = { ...DEFAULT_WIND };
    this.simulation = { ...DEFAULT_SIMULATION };

    // Initialize statistics
    this.stats = {
      totalVoxels: this.totalVoxels,
      burningVoxels: 0,
      steamingVoxels: 0,
      charredVoxels: 0,
      avgTemperature: 0,
      avgMoisture: 0,
      stepTimeMs: 0,
      fps: 0,
    };

    // Pre-compute neighbor offsets for 3D grid traversal
    this.neighborOffsets = this.computeNeighborOffsets();
    this.neighborDirections = this.computeNeighborDirections();

    // Initialize with air
    this.clear();
  }

  /**
   * Update global multipliers.
   */
  setGlobalMultipliers(burnRate: number, fuel: number): void {
    this.globalBurnRate = burnRate;
    this.globalFuel = fuel;
  }

  /**
   * Pre-compute flat array offsets for 26 neighbors.
   */
  private computeNeighborOffsets(): Int32Array {
    const offsets: number[] = [];
    const { sizeX, sizeY } = this.config;
    const sliceSize = sizeX * sizeY;

    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          offsets.push(dx + dy * sizeX + dz * sliceSize);
        }
      }
    }

    return new Int32Array(offsets);
  }

  /**
   * Pre-compute direction vectors (dx, dy, dz) for each of 26 neighbors.
   * Stored as [dx0, dy0, dz0, dx1, dy1, dz1, ...] (78 values total).
   */
  private computeNeighborDirections(): Int8Array {
    const directions: number[] = [];

    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          directions.push(dx, dy, dz);
        }
      }
    }

    return new Int8Array(directions);
  }

  /**
   * Rebuild the active voxel list by scanning the entire grid.
   * Called after scene initialization or when voxels are removed.
   */
  rebuildActiveList(): void {
    this.activeCount = 0;
    this.isActive.fill(0);

    for (let i = 0; i < this.totalVoxels; i++) {
      const materialId = this.readBuffer[i * 4 + 3];
      if (materialId !== MaterialType.AIR) {
        this.activeIndices[this.activeCount] = i;
        this.isActive[i] = 1;
        this.activeCount++;
      }
    }
  }

  /**
   * Add a voxel to the active list (if not already active).
   */
  private addToActiveList(flatIndex: number): void {
    if (this.isActive[flatIndex] === 0) {
      this.activeIndices[this.activeCount] = flatIndex;
      this.isActive[flatIndex] = 1;
      this.activeCount++;
    }
  }

  /**
   * Get active voxel data for rendering.
   * Returns { indices: Int32Array, count: number }
   */
  getActiveVoxels(): { indices: Int32Array; count: number } {
    return {
      indices: this.activeIndices,
      count: this.activeCount,
    };
  }

  /**
   * Convert 3D coordinates to flat array index.
   */
  private coordsToIndex(x: number, y: number, z: number): number {
    return x + y * this.config.sizeX + z * this.config.sizeX * this.config.sizeY;
  }

  /**
   * Convert flat index to 3D coordinates.
   */
  private indexToCoords(index: number): [number, number, number] {
    const { sizeX, sizeY } = this.config;
    const z = Math.floor(index / (sizeX * sizeY));
    const remainder = index % (sizeX * sizeY);
    const y = Math.floor(remainder / sizeX);
    const x = remainder % sizeX;
    return [x, y, z];
  }

  /**
   * Check if coordinates are within bounds.
   */
  private inBounds(x: number, y: number, z: number): boolean {
    return (
      x >= 0 &&
      x < this.config.sizeX &&
      y >= 0 &&
      y < this.config.sizeY &&
      z >= 0 &&
      z < this.config.sizeZ
    );
  }

  /**
   * Get voxel state at coordinates.
   */
  getVoxel(x: number, y: number, z: number): VoxelState | null {
    if (!this.inBounds(x, y, z)) return null;
    const idx = this.coordsToIndex(x, y, z) * 4;
    return {
      temperature: this.readBuffer[idx] / 255,
      moisture: this.readBuffer[idx + 1] / 255,
      fuel: this.readBuffer[idx + 2] / 255,
      materialId: this.readBuffer[idx + 3] as MaterialType,
    };
  }

  /**
   * Set voxel state at coordinates.
   */
  setVoxel(
    x: number,
    y: number,
    z: number,
    state: Partial<VoxelState>
  ): void {
    if (!this.inBounds(x, y, z)) return;
    const idx = this.coordsToIndex(x, y, z) * 4;

    if (state.temperature !== undefined) {
      this.readBuffer[idx] = Math.round(
        Math.max(0, Math.min(1, state.temperature)) * 255
      );
    }
    if (state.moisture !== undefined) {
      this.readBuffer[idx + 1] = Math.round(
        Math.max(0, Math.min(1, state.moisture)) * 255
      );
    }
    if (state.fuel !== undefined) {
      this.readBuffer[idx + 2] = Math.round(
        Math.max(0, Math.min(1, state.fuel)) * 255
      );
    }
    if (state.materialId !== undefined) {
      this.readBuffer[idx + 3] = state.materialId;
    }
  }

  /**
   * Set material at coordinates, initializing fuel based on material type.
   * Automatically adds to active list if non-Air.
   */
  setMaterial(x: number, y: number, z: number, material: MaterialType): void {
    if (!this.inBounds(x, y, z)) return;
    const props = MATERIAL_PROPERTIES[material];
    const flatIndex = this.coordsToIndex(x, y, z);
    const idx = flatIndex * 4;

    this.readBuffer[idx] = Math.round(this.simulation.ambientTemperature * 255);
    // Start fully hydrated
    this.readBuffer[idx + 1] = Math.round(props.moistureCapacity * 255);
    // Use global fuel multiplier
    const effectiveFuel = Math.min(1.0, props.maxFuel * this.globalFuel);
    this.readBuffer[idx + 2] = Math.round(effectiveFuel * 255);
    this.readBuffer[idx + 3] = material;

    // Add to active list if non-Air
    if (material !== MaterialType.AIR) {
      this.addToActiveList(flatIndex);
    }
  }

  /**
   * Clear the grid to all air and reset active list.
   */
  clear(): void {
    this.stateA.fill(0);
    this.stateB.fill(0);
    this.time = 0;
    // Reset sparse tracking
    this.activeCount = 0;
    this.isActive.fill(0);
  }

  /**
   * Fill a region with a material.
   */
  fillRegion(
    x1: number,
    y1: number,
    z1: number,
    x2: number,
    y2: number,
    z2: number,
    material: MaterialType
  ): void {
    const minX = Math.max(0, Math.min(x1, x2));
    const maxX = Math.min(this.config.sizeX - 1, Math.max(x1, x2));
    const minY = Math.max(0, Math.min(y1, y2));
    const maxY = Math.min(this.config.sizeY - 1, Math.max(y1, y2));
    const minZ = Math.max(0, Math.min(z1, z2));
    const maxZ = Math.min(this.config.sizeZ - 1, Math.max(z1, z2));

    for (let z = minZ; z <= maxZ; z++) {
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          this.setMaterial(x, y, z, material);
        }
      }
    }
  }

  /**
   * Fill a sphere with a material.
   */
  fillSphere(
    cx: number,
    cy: number,
    cz: number,
    radius: number,
    material: MaterialType
  ): void {
    const r2 = radius * radius;
    const minX = Math.max(0, Math.floor(cx - radius));
    const maxX = Math.min(this.config.sizeX - 1, Math.ceil(cx + radius));
    const minY = Math.max(0, Math.floor(cy - radius));
    const maxY = Math.min(this.config.sizeY - 1, Math.ceil(cy + radius));
    const minZ = Math.max(0, Math.floor(cz - radius));
    const maxZ = Math.min(this.config.sizeZ - 1, Math.ceil(cz + radius));

    for (let z = minZ; z <= maxZ; z++) {
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const dx = x - cx;
          const dy = y - cy;
          const dz = z - cz;
          if (dx * dx + dy * dy + dz * dz <= r2) {
            this.setMaterial(x, y, z, material);
          }
        }
      }
    }
  }

  /**
   * Ignite a point, setting it to high temperature.
   */
  ignite(x: number, y: number, z: number, radius: number = 2): void {
    const r2 = radius * radius;
    const minX = Math.max(0, Math.floor(x - radius));
    const maxX = Math.min(this.config.sizeX - 1, Math.ceil(x + radius));
    const minY = Math.max(0, Math.floor(y - radius));
    const maxY = Math.min(this.config.sizeY - 1, Math.ceil(y + radius));
    const minZ = Math.max(0, Math.floor(z - radius));
    const maxZ = Math.min(this.config.sizeZ - 1, Math.ceil(z + radius));

    for (let vz = minZ; vz <= maxZ; vz++) {
      for (let vy = minY; vy <= maxY; vy++) {
        for (let vx = minX; vx <= maxX; vx++) {
          const dx = vx - x;
          const dy = vy - y;
          const dz = vz - z;
          const dist2 = dx * dx + dy * dy + dz * dz;
          if (dist2 <= r2) {
            const falloff = 1 - Math.sqrt(dist2) / radius;
            const idx = this.coordsToIndex(vx, vy, vz) * 4;
            const currentTemp = this.readBuffer[idx] / 255;
            const newTemp = Math.min(1, currentTemp + 0.8 * falloff);
            this.readBuffer[idx] = Math.round(newTemp * 255);
            // Also reduce moisture to help ignition
            const currentMoist = this.readBuffer[idx + 1] / 255;
            const newMoist = Math.max(0, currentMoist - 0.5 * falloff);
            this.readBuffer[idx + 1] = Math.round(newMoist * 255);
          }
        }
      }
    }
  }

  /**
   * Add moisture to a point (extinguish).
   */
  wet(x: number, y: number, z: number, radius: number = 3): void {
    const r2 = radius * radius;
    const minX = Math.max(0, Math.floor(x - radius));
    const maxX = Math.min(this.config.sizeX - 1, Math.ceil(x + radius));
    const minY = Math.max(0, Math.floor(y - radius));
    const maxY = Math.min(this.config.sizeY - 1, Math.ceil(y + radius));
    const minZ = Math.max(0, Math.floor(z - radius));
    const maxZ = Math.min(this.config.sizeZ - 1, Math.ceil(z + radius));

    for (let vz = minZ; vz <= maxZ; vz++) {
      for (let vy = minY; vy <= maxY; vy++) {
        for (let vx = minX; vx <= maxX; vx++) {
          const dx = vx - x;
          const dy = vy - y;
          const dz = vz - z;
          const dist2 = dx * dx + dy * dy + dz * dz;
          if (dist2 <= r2) {
            const falloff = 1 - Math.sqrt(dist2) / radius;
            const idx = this.coordsToIndex(vx, vy, vz) * 4;
            const materialId = this.readBuffer[idx + 3] as MaterialType;
            const props = MATERIAL_PROPERTIES[materialId];
            const currentMoist = this.readBuffer[idx + 1] / 255;
            const newMoist = Math.min(
              props.moistureCapacity,
              currentMoist + 0.8 * falloff
            );
            this.readBuffer[idx + 1] = Math.round(newMoist * 255);
            // Also cool down
            const currentTemp = this.readBuffer[idx] / 255;
            const newTemp = Math.max(
              this.simulation.ambientTemperature,
              currentTemp - 0.3 * falloff
            );
            this.readBuffer[idx] = Math.round(newTemp * 255);
          }
        }
      }
    }
  }

  /**
   * Simple 2D noise function for wind variation.
   */
  private noise2D(x: number, z: number): number {
    // Simple hash-based noise
    const n = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
    return (n - Math.floor(n)) * 2 - 1; // -1 to 1
  }

  /**
   * Smooth noise using bilinear interpolation.
   */
  private smoothNoise(x: number, z: number): number {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;

    const n00 = this.noise2D(ix, iz);
    const n10 = this.noise2D(ix + 1, iz);
    const n01 = this.noise2D(ix, iz + 1);
    const n11 = this.noise2D(ix + 1, iz + 1);

    const nx0 = n00 * (1 - fx) + n10 * fx;
    const nx1 = n01 * (1 - fx) + n11 * fx;

    return nx0 * (1 - fz) + nx1 * fz;
  }

  /**
   * Get wind vector at a specific position (x, z).
   * Returns [windX, windZ] normalized direction scaled by speed.
   */
  getWindAt(x: number, z: number, time: number): [number, number] {
    const {
      direction,
      speed,
      turbulence,
      gustFrequency,
      gustAmplitude,
      localVariation,
      variationScale,
    } = this.wind;

    // Base direction
    const baseAngle = (direction * Math.PI) / 180;

    // Local variation based on position (creates wind "channels")
    const noiseX = x * variationScale + time * 0.1;
    const noiseZ = z * variationScale + time * 0.05;
    const localNoise = this.smoothNoise(noiseX, noiseZ);
    const localAngleOffset = localNoise * localVariation * Math.PI * 0.5;

    // Local speed variation
    const speedNoiseX = x * variationScale * 0.7 + time * 0.15 + 100;
    const speedNoiseZ = z * variationScale * 0.7 + time * 0.08 + 100;
    const speedNoise = (this.smoothNoise(speedNoiseX, speedNoiseZ) + 1) * 0.5; // 0 to 1
    const localSpeedMult = 1 - localVariation * 0.5 + speedNoise * localVariation;

    // Add temporal turbulence noise
    const turbNoiseAngle = turbulence * Math.sin(time * 2.3 + x * 0.1 + z * 0.1) * 0.5;

    // Add gusts (global)
    const gustMult =
      gustFrequency > 0
        ? 1 + gustAmplitude * Math.max(0, Math.sin(time * gustFrequency * Math.PI * 2))
        : 1;

    const angle = baseAngle + localAngleOffset + turbNoiseAngle;
    const magnitude = speed * gustMult * localSpeedMult;

    return [Math.cos(angle) * magnitude, Math.sin(angle) * magnitude];
  }

  /**
   * Get the computed wind direction as normalized vector (legacy - uses center of grid).
   */
  private getWindVector(time: number): [number, number] {
    const cx = this.config.sizeX / 2;
    const cz = this.config.sizeZ / 2;
    return this.getWindAt(cx, cz, time);
  }

  /**
   * Determine visual state from voxel data.
   */
  getVisualState(state: VoxelState): VisualState {
    const props = MATERIAL_PROPERTIES[state.materialId];

    if (state.materialId === MaterialType.AIR) {
      return VisualState.EMPTY;
    }

    // Check if burning
    const isBurning =
      state.temperature > props.ignitionTemp &&
      state.moisture < props.maxBurnMoisture &&
      state.fuel > 0 &&
      props.flammability > 0;

    if (isBurning) {
      return VisualState.BURNING;
    }

    // Check if steaming (hot + wet)
    if (state.temperature > 0.5 && state.moisture > 0.4) {
      return VisualState.STEAMING;
    }

    // Check if charred (fuel depleted on flammable material)
    if (state.fuel <= 0.01 && props.maxFuel > 0) {
      return VisualState.CHARRED;
    }

    // Check if smoldering (hot but not burning)
    if (state.temperature > props.ignitionTemp * 0.7 && props.flammability > 0) {
      return VisualState.SMOLDERING;
    }

    // Check if frozen
    if (state.temperature < 0.1 && state.moisture > 0.6) {
      return VisualState.FROZEN;
    }

    // Check if wet
    if (state.moisture > 0.5) {
      return VisualState.WET;
    }

    return VisualState.NORMAL;
  }

  /**
   * Run one simulation step using SPARSE iteration.
   * Only processes active (non-Air) voxels for performance.
   */
  step(deltaTime: number): void {
    // Clamp delta time to prevent instability when frame rate drops (e.g. during UI updates)
    // Cap at 50ms (20fps min)
    const safeDelta = Math.min(deltaTime, 0.05);
    
    const startTime = performance.now();
    const dt = safeDelta * this.simulation.timeScale;
    this.time += dt;

    const { sizeX, sizeY, sizeZ } = this.config;
    const sliceSize = sizeX * sizeY;

    // Statistics accumulators
    let burningCount = 0;
    let steamingCount = 0;
    let charredCount = 0;
    let totalTemp = 0;
    let totalMoist = 0;

    // Copy active voxel state to write buffer (only active ones need update)
    // Air voxels stay as zeros in writeBuffer
    
    // Process ONLY active voxels (sparse iteration)
    for (let ai = 0; ai < this.activeCount; ai++) {
      const flatIdx = this.activeIndices[ai];
      const idx = flatIdx * 4;
      
      // Convert flat index to 3D coordinates
      const z = Math.floor(flatIdx / sliceSize);
      const remainder = flatIdx % sliceSize;
      const y = Math.floor(remainder / sizeX);
      const x = remainder % sizeX;

      // Get local wind for this position (varies spatially)
      const localWind = this.getWindAt(x, z, this.time);
      
      const materialId = this.readBuffer[idx + 3] as MaterialType;
      const props = MATERIAL_PROPERTIES[materialId];

      // Read current state
      let temp = this.readBuffer[idx] / 255;
      let moist = this.readBuffer[idx + 1] / 255;
      let fuel = this.readBuffer[idx + 2] / 255;

      // === Heat Transfer from Neighbors ===
      let heatInflux = 0;
      let moistInflux = 0;

      for (let ni = 0; ni < 26; ni++) {
        const offset = this.neighborOffsets[ni];
        const neighborFlatIdx = flatIdx + offset;

        // Bounds check using coordinates derived from neighbor index
        const nz = Math.floor(neighborFlatIdx / sliceSize);
        const nRemainder = neighborFlatIdx % sliceSize;
        const ny = Math.floor(nRemainder / sizeX);
        const nxCalc = nRemainder % sizeX;

        // Check if neighbor is out of bounds
        if (
          neighborFlatIdx < 0 ||
          neighborFlatIdx >= this.totalVoxels ||
          nxCalc < 0 ||
          nxCalc >= sizeX ||
          ny < 0 ||
          ny >= sizeY ||
          nz < 0 ||
          nz >= sizeZ
        ) {
          continue;
        }

        // Additional check: verify the neighbor offset didn't wrap around incorrectly
        // by checking if the coordinates are within +-1 of current position
        const trueDx = nxCalc - x;
        const trueDy = ny - y;
        const trueDz = nz - z;
        if (Math.abs(trueDx) > 1 || Math.abs(trueDy) > 1 || Math.abs(trueDz) > 1) {
          continue; // Wrapped around grid edge, skip
        }

        const nIdx = neighborFlatIdx * 4;
        const nMaterialId = this.readBuffer[nIdx + 3] as MaterialType;
        const nProps = MATERIAL_PROPERTIES[nMaterialId];
        const nTemp = this.readBuffer[nIdx] / 255;

        // Direction weight based on position
        let dirWeight = 1.0;
        
        // Convection: heat rises (upward bias)
        // If neighbor is BELOW (trueDy < 0), heat flows UP to current cell
        if (trueDy < 0) {
          dirWeight *= this.simulation.convectionStrength;
        }

        // Wind bias for horizontal propagation
        if (trueDy === 0) {
          const windDot = trueDx * localWind[0] + trueDz * localWind[1];
          dirWeight *= 1 + windDot * 2;
        }

        // Distance factor (diagonal neighbors are further)
        const distSq = (trueDx !== 0 ? 1 : 0) + (trueDy !== 0 ? 1 : 0) + (trueDz !== 0 ? 1 : 0);
        const distFactor = 1 / Math.sqrt(distSq || 1);

        // Heat transfer based on temperature difference and conductivity
        const avgConductivity = (props.heatConductivity + nProps.heatConductivity) * 0.5;
        const tempDiff = nTemp - temp;
        heatInflux += tempDiff * avgConductivity * dirWeight * distFactor * 0.1;

        // Moisture transfer from water sources
        if (nProps.isMoistureSource && moist < props.moistureCapacity) {
          moistInflux += 0.05 * distFactor;
        }
      }

      // Apply heat influx
      temp += heatInflux * dt;

      // === Combustion ===
      const isBurning =
        temp > props.ignitionTemp &&
        moist < props.maxBurnMoisture &&
        fuel > 0 &&
        props.flammability > 0;

      if (isBurning) {
        // Consume fuel
        const effectiveBurnRate = props.burnRate * this.globalBurnRate;
        fuel -= effectiveBurnRate * dt * 0.1;
        fuel = Math.max(0, fuel);

        // Burning generates heat
        temp += 0.3 * dt;

        // Burning evaporates moisture faster
        moist -= props.evaporationRate * dt * 2;

        burningCount++;
      }

      // === Heat Sources ===
      if (props.isHeatSource) {
        temp = 1.0; // Always max temperature
      }

      // === Moisture Dynamics ===
      // Evaporation when hot
      if (temp > 0.3 && moist > 0) {
        const evapRate = props.evaporationRate * (temp - 0.3) * dt;
        moist -= evapRate;
      }

      // Moisture influx
      moist += moistInflux * dt;

      // Ambient humidity absorption (slow)
      if (moist < this.simulation.ambientHumidity) {
        moist += (this.simulation.ambientHumidity - moist) * 0.01 * dt;
      }

      // === Cooling ===
      // Cool toward ambient temperature
      if (!props.isHeatSource && !isBurning) {
        const coolRate = 0.1 * dt;
        temp += (this.simulation.ambientTemperature - temp) * coolRate;
      }

      // Wet materials absorb heat (heat capacity)
      if (moist > 0.3) {
        const absorption = moist * 0.1 * dt;
        temp -= absorption * (temp - this.simulation.ambientTemperature);
      }

      // === Clamp Values ===
      temp = Math.max(0, Math.min(1, temp));
      moist = Math.max(0, Math.min(props.moistureCapacity, moist));
      fuel = Math.max(0, Math.min(1, fuel));

      // === Write to output buffer ===
      this.writeBuffer[idx] = Math.round(temp * 255);
      this.writeBuffer[idx + 1] = Math.round(moist * 255);
      this.writeBuffer[idx + 2] = Math.round(fuel * 255);
      this.writeBuffer[idx + 3] = materialId;

      // === Statistics ===
      totalTemp += temp;
      totalMoist += moist;

      if (temp > 0.5 && moist > 0.4) {
        steamingCount++;
      }
      if (fuel <= 0.01 && props.maxFuel > 0) {
        charredCount++;
      }
    }

    // Swap buffers
    const tmp = this.readBuffer;
    this.readBuffer = this.writeBuffer;
    this.writeBuffer = tmp;

    // Update statistics
    const endTime = performance.now();
    this.stats.burningVoxels = burningCount;
    this.stats.steamingVoxels = steamingCount;
    this.stats.charredVoxels = charredCount;
    this.stats.avgTemperature = this.activeCount > 0 ? totalTemp / this.activeCount : 0;
    this.stats.avgMoisture = this.activeCount > 0 ? totalMoist / this.activeCount : 0;
    this.stats.stepTimeMs = endTime - startTime;
    this.stats.fps = this.stats.stepTimeMs > 0 ? 1000 / this.stats.stepTimeMs : 0;
  }

  /**
   * Get current statistics.
   */
  getStats(): SimulationStats {
    return { ...this.stats };
  }

  /**
   * Get the current state buffer for rendering.
   */
  getStateBuffer(): Uint8Array {
    return this.readBuffer;
  }

  /**
   * Get simulation time.
   */
  getTime(): number {
    return this.time;
  }
}

// ============================================================================
// Scene Preset Initializers
// ============================================================================

/**
 * Helper to paint a 2D disk on the ground (y=0 only).
 */
function paintDisk(
  system: FireSystem,
  cx: number,
  cz: number,
  radius: number,
  material: MaterialType
): void {
  const { sizeX, sizeZ } = system.config;
  const r2 = radius * radius;

  for (let z = Math.max(0, Math.floor(cz - radius)); z <= Math.min(sizeZ - 1, Math.ceil(cz + radius)); z++) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(sizeX - 1, Math.ceil(cx + radius)); x++) {
      const dx = x - cx;
      const dz = z - cz;
      if (dx * dx + dz * dz <= r2) {
        system.setMaterial(x, 0, z, material);
      }
    }
  }
}

/**
 * Initialize a grass field scene - flat 2D terrain with patches.
 */
export function initGrassField(system: FireSystem): void {
  const { sizeX, sizeZ } = system.config;

  // Fill ground layer with grass (y=0 only)
  for (let z = 0; z < sizeZ; z++) {
    for (let x = 0; x < sizeX; x++) {
      system.setMaterial(x, 0, z, MaterialType.GRASS);
    }
  }

  // Add some patches of dry brush
  const patchCount = Math.floor((sizeX * sizeZ) / 400);
  for (let i = 0; i < patchCount; i++) {
    const cx = Math.floor(Math.random() * sizeX);
    const cz = Math.floor(Math.random() * sizeZ);
    const r = 2 + Math.floor(Math.random() * 4);
    paintDisk(system, cx, cz, r, MaterialType.DRY_BRUSH);
  }

  // Add a few water puddles
  for (let i = 0; i < 3; i++) {
    const cx = Math.floor(Math.random() * sizeX);
    const cz = Math.floor(Math.random() * sizeZ);
    paintDisk(system, cx, cz, 2 + Math.random() * 2, MaterialType.WATER);
  }

  // Rebuild active list after all materials are set
  system.rebuildActiveList();
}

/**
 * Initialize a forest scene - grass ground with tree trunks and canopy.
 */
export function initForest(system: FireSystem): void {
  const { sizeX, sizeY, sizeZ } = system.config;

  // Ground layer: grass
  for (let z = 0; z < sizeZ; z++) {
    for (let x = 0; x < sizeX; x++) {
      system.setMaterial(x, 0, z, MaterialType.GRASS);
    }
  }

  // Scatter some dry brush
  const brushCount = Math.floor((sizeX * sizeZ) / 600);
  for (let i = 0; i < brushCount; i++) {
    const cx = Math.floor(Math.random() * sizeX);
    const cz = Math.floor(Math.random() * sizeZ);
    paintDisk(system, cx, cz, 3 + Math.random() * 3, MaterialType.DRY_BRUSH);
  }

  // Add trees (thin trunks + leaf canopy spheres)
  const treeCount = Math.floor((sizeX * sizeZ) / 150);
  for (let i = 0; i < treeCount; i++) {
    const tx = 2 + Math.floor(Math.random() * (sizeX - 4));
    const tz = 2 + Math.floor(Math.random() * (sizeZ - 4));
    const trunkHeight = 3 + Math.floor(Math.random() * 3);
    const canopyRadius = 2;

    // Trunk (single column of wood)
    for (let y = 1; y <= trunkHeight && y < sizeY; y++) {
      system.setMaterial(tx, y, tz, MaterialType.WOOD);
    }

    // Canopy (leaves) - small sphere at top
    const canopyY = trunkHeight + 1;
    if (canopyY + canopyRadius < sizeY) {
      system.fillSphere(tx, canopyY, tz, canopyRadius, MaterialType.LEAVES);
    }
  }

  // Add a stream of water
  const streamZ = Math.floor(sizeZ / 2);
  for (let x = 0; x < sizeX; x++) {
    system.setMaterial(x, 0, streamZ - 1, MaterialType.WATER);
    system.setMaterial(x, 0, streamZ, MaterialType.WATER);
    system.setMaterial(x, 0, streamZ + 1, MaterialType.WATER);
  }

  // Rebuild active list after all materials are set
  system.rebuildActiveList();
}

/**
 * Initialize a mixed terrain scene - varied ground with structures.
 */
export function initMixedTerrain(system: FireSystem): void {
  const { sizeX, sizeY, sizeZ } = system.config;

  // Mostly grass ground
  for (let z = 0; z < sizeZ; z++) {
    for (let x = 0; x < sizeX; x++) {
      system.setMaterial(x, 0, z, MaterialType.GRASS);
    }
  }

  // Stone outcrops (small raised areas)
  for (let i = 0; i < 4; i++) {
    const cx = Math.floor(Math.random() * sizeX);
    const cz = Math.floor(Math.random() * sizeZ);
    const r = 2 + Math.floor(Math.random() * 2);
    paintDisk(system, cx, cz, r, MaterialType.STONE);
    // Add a small height
    for (let dy = 1; dy <= 2; dy++) {
      if (dy < sizeY) {
        system.setMaterial(cx, dy, cz, MaterialType.STONE);
      }
    }
  }

  // Dry brush patches
  const brushCount = Math.floor((sizeX * sizeZ) / 300);
  for (let i = 0; i < brushCount; i++) {
    const cx = Math.floor(Math.random() * sizeX);
    const cz = Math.floor(Math.random() * sizeZ);
    paintDisk(system, cx, cz, 3 + Math.random() * 2, MaterialType.DRY_BRUSH);
  }

  // Add trees (scattered)
  const treeCount = Math.floor((sizeX * sizeZ) / 250);
  for (let i = 0; i < treeCount; i++) {
    const tx = 2 + Math.floor(Math.random() * (sizeX - 4));
    const tz = 2 + Math.floor(Math.random() * (sizeZ - 4));
    const trunkHeight = 3 + Math.floor(Math.random() * 3);
    const canopyRadius = 2;

    // Trunk (single column of wood)
    for (let y = 1; y <= trunkHeight && y < sizeY; y++) {
      system.setMaterial(tx, y, tz, MaterialType.WOOD);
    }

    // Canopy (leaves) - small sphere at top
    const canopyY = trunkHeight + 1;
    if (canopyY + canopyRadius < sizeY) {
      system.fillSphere(tx, canopyY, tz, canopyRadius, MaterialType.LEAVES);
    }
  }

  // Small wood structures (just ground footprint + a few layers up)
  for (let i = 0; i < 2; i++) {
    const bx = 4 + Math.floor(Math.random() * (sizeX - 8));
    const bz = 4 + Math.floor(Math.random() * (sizeZ - 8));
    const bh = 2 + Math.floor(Math.random() * 2);
    
    // Just the walls (hollow structure)
    for (let y = 0; y <= bh && y < sizeY; y++) {
      for (let dx = -2; dx <= 2; dx++) {
        system.setMaterial(bx + dx, y, bz - 2, MaterialType.WOOD);
        system.setMaterial(bx + dx, y, bz + 2, MaterialType.WOOD);
      }
      for (let dz = -1; dz <= 1; dz++) {
        system.setMaterial(bx - 2, y, bz + dz, MaterialType.WOOD);
        system.setMaterial(bx + 2, y, bz + dz, MaterialType.WOOD);
      }
    }
  }

  // Water body
  const waterX = Math.floor(sizeX * 0.7);
  const waterZ = Math.floor(sizeZ * 0.3);
  paintDisk(system, waterX, waterZ, 4, MaterialType.WATER);

  // Rebuild active list after all materials are set
  system.rebuildActiveList();
}

// ============================================================================
// Exports
// ============================================================================

export { MaterialType, VisualState, MATERIAL_PROPERTIES } from "./types";

