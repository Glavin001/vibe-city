"use client";

/**
 * FireGridMesh Component
 *
 * Renders the fire simulation grid using InstancedMesh for efficient rendering.
 * Uses SPARSE rendering - only renders non-air voxels for performance.
 */

import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { FireSystem } from "@/lib/fire-propagation/fire-system";
import {
  MaterialType,
  MATERIAL_PROPERTIES,
} from "@/lib/fire-propagation/types";

interface FireGridMeshProps {
  system: FireSystem;
  showDebugGrid?: boolean;
}

// Pre-computed color palette - VERY BRIGHT vibrant colors
const COLORS = {
  // Base material colors - super bright
  [MaterialType.AIR]: new THREE.Color(0x000000),
  [MaterialType.GRASS]: new THREE.Color(0x44ff44), // Bright neon green
  [MaterialType.DRY_BRUSH]: new THREE.Color(0xffcc66), // Bright tan/yellow
  [MaterialType.WOOD]: new THREE.Color(0xcc8844), // Bright orange-brown
  [MaterialType.LEAVES]: new THREE.Color(0x22ff66), // Bright lime green
  [MaterialType.STONE]: new THREE.Color(0xaaaaaa), // Light gray
  [MaterialType.WATER]: new THREE.Color(0x44aaff), // Bright cyan-blue
  [MaterialType.LAVA]: new THREE.Color(0xff4400), // Bright orange

  // State colors
  charred: new THREE.Color(0x444444),
  wet: new THREE.Color(0x6699ff),
  steam: new THREE.Color(0xffffff),
  fire: {
    core: new THREE.Color(0xffff00), // Bright yellow
    mid: new THREE.Color(0xff8800), // Orange
    outer: new THREE.Color(0xff2200), // Red
  },
  smolder: new THREE.Color(0xff6622),
};

/**
 * Get color for a voxel based on its state.
 */
function getVoxelColor(
  temp: number,
  moist: number,
  fuel: number,
  materialId: MaterialType,
  time: number,
  index: number,
  outColor: THREE.Color
): THREE.Color {
  const props = MATERIAL_PROPERTIES[materialId];

  if (materialId === MaterialType.AIR) {
    return outColor.setRGB(0, 0, 0);
  }

  // Get base color - use a fresh copy
  const baseColor = COLORS[materialId];
  if (baseColor) {
    outColor.copy(baseColor);
  } else {
    outColor.copy(COLORS[MaterialType.GRASS]);
  }

  // Determine visual state
  const isBurning =
    temp > props.ignitionTemp &&
    moist < props.maxBurnMoisture &&
    fuel > 0 &&
    props.flammability > 0;

  const isSteaming = temp > 0.5 && moist > 0.4;
  const isCharred = fuel <= 0.01 && props.maxFuel > 0;
  const isWet = moist > 0.5;
  const isSmoldering =
    temp > props.ignitionTemp * 0.7 && props.flammability > 0 && !isBurning;

  // Apply visual states (priority order)
  if (isCharred) {
    outColor.copy(COLORS.charred);
  } else if (isBurning) {
    // Fire gradient based on temperature
    const fireIntensity = temp * (1 - moist);
    // Add flicker
    const flicker =
      0.8 +
      0.2 *
        Math.sin(time * 10 + index * 0.1) *
        Math.cos(time * 7 + index * 0.3);

    if (fireIntensity > 0.7) {
      outColor.lerpColors(
        COLORS.fire.mid,
        COLORS.fire.core,
        (fireIntensity - 0.7) / 0.3
      );
    } else if (fireIntensity > 0.3) {
      outColor.lerpColors(
        COLORS.fire.outer,
        COLORS.fire.mid,
        (fireIntensity - 0.3) / 0.4
      );
    } else {
      outColor.copy(COLORS.fire.outer).multiplyScalar(0.5 + fireIntensity);
    }

    outColor.multiplyScalar(flicker);
  } else if (isSteaming) {
    outColor.lerp(COLORS.steam, moist * 0.5);
  } else if (isSmoldering) {
    outColor.lerp(COLORS.smolder, temp * 0.5);
  } else if (isWet) {
    outColor.lerp(COLORS.wet, moist * 0.3);
  }

  // Special cases - override base color
  if (materialId === MaterialType.LAVA) {
    const pulse = 0.85 + 0.15 * Math.sin(time * 3 + index);
    outColor.copy(COLORS[MaterialType.LAVA]).multiplyScalar(pulse);
  }

  if (materialId === MaterialType.WATER) {
    const shimmer = 0.9 + 0.1 * Math.sin(time * 2 + index * 0.5);
    outColor.copy(COLORS[MaterialType.WATER]).multiplyScalar(shimmer);
  }

  return outColor;
}

/**
 * FireGridMesh renders only non-air voxels using sparse instancing.
 */
export function FireGridMesh({
  system,
  showDebugGrid = false,
}: FireGridMeshProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const tempColor = useMemo(() => new THREE.Color(), []);
  const isInitialized = useRef(false);

  const { sizeX, sizeY, sizeZ, voxelSize, originX, originY, originZ } =
    system.config;
  const totalVoxels = sizeX * sizeY * sizeZ;

  // Max instances we might need
  const maxInstances = totalVoxels;

  // Create geometry
  const geometry = useMemo(() => {
    return new THREE.BoxGeometry(
      voxelSize * 0.9,
      voxelSize * 0.9,
      voxelSize * 0.9
    );
  }, [voxelSize]);

  // Create material - MeshBasicMaterial ignores lighting, shows pure colors
  const material = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      // vertexColors: true,
    });
  }, []);

  // Initialize instanceColor on mount
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    // Create and assign instanceColor buffer
    const colors = new Float32Array(maxInstances * 3);
    // Initialize all to green so we can see something
    for (let i = 0; i < maxInstances; i++) {
      colors[i * 3] = 0.3;
      colors[i * 3 + 1] = 0.6;
      colors[i * 3 + 2] = 0.2;
    }

    mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    mesh.count = 0; // Start with nothing visible
    
    // Force material update to ensure shader picks up the new attribute
    if (mesh.material instanceof THREE.Material) {
      mesh.material.needsUpdate = true;
    }
    
    isInitialized.current = true;
  }, [maxInstances]);

  // Update positions and colors each frame - SPARSE rendering using activeVoxels
  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh || !mesh.instanceColor || !isInitialized.current) return;

    const time = clock.getElapsedTime();
    const stateBuffer = system.getStateBuffer();
    const colorArray = (mesh.instanceColor as THREE.InstancedBufferAttribute)
      .array as Float32Array;

    // Get active voxels from the system (sparse list)
    const { indices, count } = system.getActiveVoxels();
    const sliceSize = sizeX * sizeY;

    // Process only active (non-air) voxels
    for (let ai = 0; ai < count; ai++) {
      const flatIndex = indices[ai];
      const offset = flatIndex * 4;
      const materialId = stateBuffer[offset + 3] as MaterialType;

      // Convert flat index to 3D coordinates
      const z = Math.floor(flatIndex / sliceSize);
      const remainder = flatIndex % sliceSize;
      const y = Math.floor(remainder / sizeX);
      const x = remainder % sizeX;

      const temp = stateBuffer[offset] / 255;
      const moist = stateBuffer[offset + 1] / 255;
      const fuel = stateBuffer[offset + 2] / 255;

      // Calculate world position for this voxel
      dummy.position.set(
        originX + (x + 0.5) * voxelSize,
        originY + (y + 0.5) * voxelSize,
        originZ + (z + 0.5) * voxelSize
      );

      // Scale based on burning state
      const props = MATERIAL_PROPERTIES[materialId];
      const isBurning =
        temp > props.ignitionTemp &&
        moist < props.maxBurnMoisture &&
        fuel > 0 &&
        props.flammability > 0;

      const scale = isBurning
        ? 1 + 0.1 * Math.sin(time * 8 + flatIndex)
        : 1;
      dummy.scale.setScalar(scale);

      dummy.updateMatrix();
      mesh.setMatrixAt(ai, dummy.matrix);

      // Get color for this voxel
      getVoxelColor(
        temp,
        moist,
        fuel,
        materialId,
        time,
        flatIndex,
        tempColor
      );

      // Write color to array
      colorArray[ai * 3] = tempColor.r;
      colorArray[ai * 3 + 1] = tempColor.g;
      colorArray[ai * 3 + 2] = tempColor.b;
    }

    // Update mesh
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    (mesh.instanceColor as THREE.InstancedBufferAttribute).needsUpdate = true;
  });

  return (
    <>
      <instancedMesh
        ref={meshRef}
        args={[geometry, material, maxInstances]}
        frustumCulled={false}
      />
      {showDebugGrid && (
        <DebugGridBounds
          sizeX={sizeX}
          sizeY={sizeY}
          sizeZ={sizeZ}
          voxelSize={voxelSize}
          originX={originX}
          originY={originY}
          originZ={originZ}
        />
      )}
    </>
  );
}

/**
 * Debug overlay showing the simulation grid bounds.
 */
function DebugGridBounds({
  sizeX,
  sizeY,
  sizeZ,
  voxelSize,
  originX,
  originY,
  originZ,
}: {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  voxelSize: number;
  originX: number;
  originY: number;
  originZ: number;
}) {
  const width = sizeX * voxelSize;
  const height = sizeY * voxelSize;
  const depth = sizeZ * voxelSize;

  const centerX = originX + width / 2;
  const centerY = originY + height / 2;
  const centerZ = originZ + depth / 2;

  return (
    <group position={[centerX, centerY, centerZ]}>
      {/* Wireframe box showing bounds */}
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(width, height, depth)]} />
        <lineBasicMaterial color={0x00ff00} opacity={0.5} transparent />
      </lineSegments>

      {/* Semi-transparent faces */}
      <mesh>
        <boxGeometry args={[width, height, depth]} />
        <meshBasicMaterial
          color={0x00ff00}
          opacity={0.05}
          transparent
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Ground plane indicator */}
      <mesh
        position={[0, -height / 2 + voxelSize / 2, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[width, depth]} />
        <meshBasicMaterial
          color={0x00ff00}
          opacity={0.1}
          transparent
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

/**
 * Ground plane for the scene.
 */
export function GroundPlane({
  size = 100,
  color = 0x44ff44,
}: {
  size?: number;
  color?: number;
}) {
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, -0.01, 0]}
    >
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial color={color} />
    </mesh>
  );
}

/**
 * Emissive overlay for burning voxels (optional enhancement).
 * Uses sparse rendering - only creates particles for burning voxels.
 */
export function FireGlowEffect({ system }: { system: FireSystem }) {
  const pointsRef = useRef<THREE.Points>(null);

  const { sizeX, sizeY, sizeZ, voxelSize, originX, originY, originZ } =
    system.config;
  const totalVoxels = sizeX * sizeY * sizeZ;
  const sliceSize = sizeX * sizeY;

  // Create buffers - sized for max possible particles
  const [positions, colors, sizes] = useMemo(() => {
    const pos = new Float32Array(totalVoxels * 3);
    const col = new Float32Array(totalVoxels * 3);
    const siz = new Float32Array(totalVoxels);
    return [pos, col, siz];
  }, [totalVoxels]);

  // Update glow particles based on burning state - using sparse active list
  useFrame(({ clock }) => {
    const points = pointsRef.current;
    if (!points) return;

    const time = clock.getElapsedTime();
    const stateBuffer = system.getStateBuffer();
    const geometry = points.geometry;
    const posAttr = geometry.attributes.position as THREE.BufferAttribute;
    const sizeAttr = geometry.attributes.size as THREE.BufferAttribute;
    const colorAttr = geometry.attributes.color as THREE.BufferAttribute;

    // Get active voxels from the system (sparse list)
    const { indices, count } = system.getActiveVoxels();

    let particleCount = 0;

    // Only iterate over active voxels
    for (let ai = 0; ai < count; ai++) {
      const flatIndex = indices[ai];
      const offset = flatIndex * 4;
      const temp = stateBuffer[offset] / 255;
      const moist = stateBuffer[offset + 1] / 255;
      const fuel = stateBuffer[offset + 2] / 255;
      const materialId = stateBuffer[offset + 3] as MaterialType;
      const props = MATERIAL_PROPERTIES[materialId];

      const isBurning =
        temp > props.ignitionTemp &&
        moist < props.maxBurnMoisture &&
        fuel > 0 &&
        props.flammability > 0;

      if (isBurning || materialId === MaterialType.LAVA) {
        // Convert flat index to 3D coordinates
        const z = Math.floor(flatIndex / sliceSize);
        const remainder = flatIndex % sliceSize;
        const y = Math.floor(remainder / sizeX);
        const x = remainder % sizeX;

        const flicker = 0.8 + 0.2 * Math.sin(time * 10 + flatIndex * 0.3);

        // Set position
        posAttr.array[particleCount * 3] = originX + (x + 0.5) * voxelSize;
        posAttr.array[particleCount * 3 + 1] =
          originY + (y + 0.5) * voxelSize;
        posAttr.array[particleCount * 3 + 2] =
          originZ + (z + 0.5) * voxelSize;

        // Set size
        sizeAttr.array[particleCount] = voxelSize * 2 * temp * flicker;

        // Set color
        colorAttr.array[particleCount * 3] = 1;
        colorAttr.array[particleCount * 3 + 1] = 0.3 + 0.4 * temp;
        colorAttr.array[particleCount * 3 + 2] = 0.1 * temp;

        particleCount++;
      }
    }

    // Update draw range to only render active particles
    geometry.setDrawRange(0, particleCount);
    posAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
        <bufferAttribute attach="attributes-size" args={[sizes, 1]} />
      </bufferGeometry>
      <pointsMaterial
        vertexColors
        size={1}
        sizeAttenuation
        transparent
        opacity={0.6}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}

export default FireGridMesh;

