/**
 * Multi-Layer Debris Particle System for Tornado Simulation
 * 
 * Uses WebGPU TSL compute shaders for real-time physics simulation.
 * Three particle layers:
 * - Dust: 50k small particles for volumetric appearance
 * - Debris: 10k medium particles (leaves, paper, etc.)
 * - Heavy: 1k large particles (wood, roof pieces)
 */

"use client";

import { useRef, useMemo, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three/webgpu";
import * as TSL from "three/tsl";
import type { TornadoParams } from "@/app/tornado/page";
import { calculateVortexVelocity, calculateDragForce, calculateLiftForce } from "./shaders/vortex-physics";

// EF Scale to wind speed mapping (m/s)
const EF_WIND_SPEEDS = [29, 42, 58, 74, 90, 105];

interface DebrisLayer {
  name: string;
  count: number;
  size: [number, number]; // [min, max]
  mass: [number, number]; // [min, max] in kg
  dragCoeff: number;
  liftCoeff: number;
  color: THREE.Color;
  opacity: number;
  spawnRadius: number;
  spawnHeight: [number, number];
}

// Realistic debris colors from reference images
const DEBRIS_COLORS = {
  // Brown/tan for dirt and debris - the most prominent visual feature
  baseDust: new THREE.Color(0x8B7355),    // Tan/brown
  midDust: new THREE.Color(0x7A6248),     // Medium brown
  darkDust: new THREE.Color(0x5C4A3D),    // Dark brown
  debris: new THREE.Color(0x4A3C32),      // Dark debris
  heavy: new THREE.Color(0x3D322A),       // Very dark pieces
};

const DEBRIS_LAYERS: DebrisLayer[] = [
  // MASSIVE base debris cloud - THE key visual feature
  {
    name: "baseCloud",
    count: 60000,
    size: [1.0, 4.0],
    mass: [0.001, 0.05],
    dragCoeff: 0.5,
    liftCoeff: 0.2,
    color: DEBRIS_COLORS.baseDust,
    opacity: 0.5,
    spawnRadius: 300, // Much wider than funnel
    spawnHeight: [0, 80], // Concentrated at ground
  },
  // Dense inner dust column
  {
    name: "innerDust",
    count: 30000,
    size: [0.5, 2.0],
    mass: [0.001, 0.02],
    dragCoeff: 0.47,
    liftCoeff: 0.15,
    color: DEBRIS_COLORS.midDust,
    opacity: 0.6,
    spawnRadius: 150,
    spawnHeight: [0, 150],
  },
  // Visible debris pieces
  {
    name: "debris",
    count: 8000,
    size: [1.5, 4.0],
    mass: [0.1, 2.0],
    dragCoeff: 1.0,
    liftCoeff: 0.4,
    color: DEBRIS_COLORS.debris,
    opacity: 0.8,
    spawnRadius: 120,
    spawnHeight: [0, 200],
  },
  // Heavy chunks
  {
    name: "heavy",
    count: 2000,
    size: [3.0, 8.0],
    mass: [5.0, 50.0],
    dragCoeff: 1.2,
    liftCoeff: 0.25,
    color: DEBRIS_COLORS.heavy,
    opacity: 0.9,
    spawnRadius: 80,
    spawnHeight: [0, 100],
  },
];

interface DebrisSystemProps {
  params: TornadoParams;
  tornadoPosition: THREE.Vector3;
}

/**
 * Single debris layer component with GPU compute physics
 */
function DebrisLayerMesh({
  layer,
  params,
  tornadoPosition,
}: {
  layer: DebrisLayer;
  params: TornadoParams;
  tornadoPosition: THREE.Vector3;
}) {
  const { gl } = useThree();
  const meshRef = useRef<THREE.Mesh>(null);
  const clockRef = useRef(new THREE.Clock());
  
  // Get wind speed from EF scale
  const windSpeed = EF_WIND_SPEEDS[params.intensity];
  
  // Create compute system
  const computeSystem = useMemo(() => {
    const count = Math.floor(layer.count * params.debrisDensity);
    if (count < 1) return null;
    
    // Create instanced arrays for particle data
    const positionBuffer = TSL.instancedArray(count, "vec3");
    const velocityBuffer = TSL.instancedArray(count, "vec3");
    const attributeBuffer = TSL.instancedArray(count, "vec4"); // [size, mass, life, age]
    
    // Random seed helper
    const randUint = () => TSL.uint(Math.random() * 0xffffff);
    
    // Uniforms
    const uTornadoPos = TSL.uniform(TSL.vec3(0, 0, 0));
    const uCoreRadius = TSL.uniform(params.coreRadius);
    const uMaxVelocity = TSL.uniform(windSpeed);
    const uHeight = TSL.uniform(params.height);
    const uInflowStrength = TSL.uniform(15.0);
    const uUpdraftStrength = TSL.uniform(40.0);
    const uTurbulence = TSL.uniform(params.turbulence);
    const uRotationDir = TSL.uniform(params.rotationDirection);
    const uTime = TSL.uniform(0.0);
    const uDeltaTime = TSL.uniform(0.016);
    const uSpawnRadius = TSL.uniform(layer.spawnRadius);
    const uGravity = TSL.uniform(9.81);
    
    // Initialize particles
    const computeInit = TSL.Fn(() => {
      const position = positionBuffer.element(TSL.instanceIndex);
      const velocity = velocityBuffer.element(TSL.instanceIndex);
      const attributes = attributeBuffer.element(TSL.instanceIndex);
      
      // Random spawn position (cylindrical distribution)
      const randAngle = TSL.hash(TSL.instanceIndex).mul(Math.PI * 2);
      const randRadius = TSL.hash(TSL.instanceIndex.add(randUint())).mul(uSpawnRadius);
      const randHeight = TSL.hash(TSL.instanceIndex.add(randUint()))
        .mul(layer.spawnHeight[1] - layer.spawnHeight[0])
        .add(layer.spawnHeight[0]);
      
      position.x.assign(TSL.cos(randAngle).mul(randRadius).add(uTornadoPos.x));
      position.y.assign(randHeight);
      position.z.assign(TSL.sin(randAngle).mul(randRadius).add(uTornadoPos.z));
      
      // Initial velocity (small random)
      velocity.x.assign(TSL.hash(TSL.instanceIndex.add(randUint())).sub(0.5).mul(2.0));
      velocity.y.assign(TSL.hash(TSL.instanceIndex.add(randUint())).mul(2.0));
      velocity.z.assign(TSL.hash(TSL.instanceIndex.add(randUint())).sub(0.5).mul(2.0));
      
      // Attributes: [size, mass, maxLife, currentAge]
      const size = TSL.hash(TSL.instanceIndex.add(randUint()))
        .mul(layer.size[1] - layer.size[0])
        .add(layer.size[0]);
      const mass = TSL.hash(TSL.instanceIndex.add(randUint()))
        .mul(layer.mass[1] - layer.mass[0])
        .add(layer.mass[0]);
      const maxLife = TSL.hash(TSL.instanceIndex.add(randUint())).mul(20.0).add(10.0);
      
      attributes.x.assign(size);
      attributes.y.assign(mass);
      attributes.z.assign(maxLife);
      attributes.w.assign(TSL.hash(TSL.instanceIndex.add(randUint())).mul(maxLife)); // Random start age
    })().compute(count);
    
    // Update particles each frame
    const computeUpdate = TSL.Fn(() => {
      const position = positionBuffer.element(TSL.instanceIndex);
      const velocity = velocityBuffer.element(TSL.instanceIndex);
      const attributes = attributeBuffer.element(TSL.instanceIndex);
      
      const size = attributes.x;
      const mass = attributes.y;
      const maxLife = attributes.z;
      const age = attributes.w;
      
      // Calculate vortex wind velocity at particle position
      const windVel = calculateVortexVelocity(
        position,
        uTornadoPos,
        uCoreRadius,
        uMaxVelocity,
        uHeight,
        uInflowStrength,
        uUpdraftStrength,
        uTurbulence,
        uRotationDir,
        uTime
      );
      
      // Calculate cross-sectional area from size (assuming sphere-ish)
      const area = size.mul(size).mul(Math.PI * 0.25);
      
      // Calculate drag force
      const dragForce = calculateDragForce(
        velocity,
        windVel,
        TSL.float(layer.dragCoeff),
        area
      );
      
      // Calculate lift force
      const liftForce = calculateLiftForce(
        windVel,
        TSL.float(layer.liftCoeff),
        area
      );
      
      // Gravity force
      const gravityForce = TSL.vec3(0.0, mass.mul(uGravity).mul(-1.0), 0.0);
      
      // Total force
      const totalForce = dragForce.add(liftForce).add(gravityForce);
      
      // Acceleration (F = ma, so a = F/m)
      const acceleration = totalForce.div(mass);
      
      // Update velocity (semi-implicit Euler)
      velocity.addAssign(acceleration.mul(uDeltaTime));
      
      // Clamp velocity to prevent instability
      const maxSpeed = uMaxVelocity.mul(2.0);
      const speed = TSL.length(velocity);
      TSL.If(speed.greaterThan(maxSpeed), () => {
        velocity.assign(velocity.div(speed).mul(maxSpeed));
      });
      
      // Update position
      position.addAssign(velocity.mul(uDeltaTime));
      
      // Ground collision
      TSL.If(position.y.lessThan(0.5), () => {
        position.y.assign(0.5);
        velocity.y.assign(TSL.abs(velocity.y).mul(0.3)); // Bounce with energy loss
        velocity.x.mulAssign(0.8); // Ground friction
        velocity.z.mulAssign(0.8);
      });
      
      // Height cap
      TSL.If(position.y.greaterThan(uHeight.mul(1.5)), () => {
        position.y.assign(uHeight.mul(1.5));
        velocity.y.mulAssign(-0.1);
      });
      
      // Update age
      attributes.w.assign(age.add(uDeltaTime));
      
      // Respawn if aged out or too far from tornado
      const distFromTornado = TSL.length(
        TSL.vec2(position.x.sub(uTornadoPos.x), position.z.sub(uTornadoPos.z))
      );
      const shouldRespawn = age.greaterThan(maxLife).or(distFromTornado.greaterThan(uSpawnRadius.mul(3.0)));
      
      TSL.If(shouldRespawn, () => {
        // Respawn near tornado
        const newAngle = TSL.hash(TSL.instanceIndex.add(uTime.mul(1000.0))).mul(Math.PI * 2);
        const newRadius = TSL.hash(TSL.instanceIndex.add(uTime.mul(1001.0))).mul(uSpawnRadius.mul(0.5));
        const newHeight = TSL.hash(TSL.instanceIndex.add(uTime.mul(1002.0)))
          .mul(layer.spawnHeight[1] - layer.spawnHeight[0])
          .add(layer.spawnHeight[0]);
        
        position.x.assign(TSL.cos(newAngle).mul(newRadius).add(uTornadoPos.x));
        position.y.assign(newHeight);
        position.z.assign(TSL.sin(newAngle).mul(newRadius).add(uTornadoPos.z));
        
        velocity.assign(TSL.vec3(0.0, 0.0, 0.0));
        attributes.w.assign(0.0); // Reset age
      });
    })().compute(count);
    
    return {
      count,
      positionBuffer,
      velocityBuffer,
      attributeBuffer,
      computeInit,
      computeUpdate,
      uniforms: {
        uTornadoPos,
        uCoreRadius,
        uMaxVelocity,
        uHeight,
        uInflowStrength,
        uUpdraftStrength,
        uTurbulence,
        uRotationDir,
        uTime,
        uDeltaTime,
        uSpawnRadius,
        uGravity,
      },
    };
  }, [layer, params.debrisDensity, params.coreRadius, params.height, params.turbulence, params.rotationDirection, windSpeed]);
  
  // Create material
  const material = useMemo(() => {
    if (!computeSystem) return null;
    
    const { positionBuffer, attributeBuffer } = computeSystem;
    
    const mat = new THREE.MeshBasicNodeMaterial();
    
    // Get particle attributes
    const attributes = attributeBuffer.element(TSL.instanceIndex);
    const age = attributes.w;
    const maxLife = attributes.z;
    
    // Age-based fade
    const lifeFraction = age.div(maxLife);
    const fadeIn = TSL.smoothstep(TSL.float(0.0), TSL.float(0.1), lifeFraction);
    const fadeOut = TSL.smoothstep(TSL.float(0.9), TSL.float(1.0), lifeFraction).oneMinus();
    const fade = fadeIn.mul(fadeOut);
    
    // Color with slight variation
    const colorVar = TSL.hash(TSL.instanceIndex).mul(0.2).sub(0.1);
    const baseColor = TSL.vec3(layer.color.r, layer.color.g, layer.color.b)
      .add(TSL.vec3(colorVar, colorVar, colorVar));
    
    mat.colorNode = baseColor;
    mat.opacityNode = TSL.float(layer.opacity).mul(fade);
    
    // Billboard towards camera with instanced position
    mat.vertexNode = TSL.billboarding({
      position: positionBuffer.toAttribute(),
    });
    
    mat.transparent = true;
    mat.depthWrite = false;
    mat.side = THREE.DoubleSide;
    
    return mat;
  }, [computeSystem, layer.color, layer.opacity]);
  
  // Initialize compute on mount
  useEffect(() => {
    if (!computeSystem || !gl || !("computeAsync" in gl)) return;
    
    // Update uniforms before init
    computeSystem.uniforms.uTornadoPos.value.set(
      tornadoPosition.x,
      tornadoPosition.y,
      tornadoPosition.z
    );
    
    // Run init compute
    (gl as unknown as { computeAsync: (compute: unknown) => Promise<void> }).computeAsync(computeSystem.computeInit);
  }, [computeSystem, gl, tornadoPosition]);
  
  // Create geometry for billboard particles (must be before conditional returns)
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1);
    return geo;
  }, []);
  
  // Update each frame
  useFrame(() => {
    if (!computeSystem || !gl || !("compute" in gl)) return;
    
    const delta = Math.min(clockRef.current.getDelta(), 0.05);
    const time = clockRef.current.getElapsedTime();
    
    // Update uniforms
    const { uniforms } = computeSystem;
    uniforms.uTornadoPos.value.set(tornadoPosition.x, tornadoPosition.y, tornadoPosition.z);
    uniforms.uCoreRadius.value = params.coreRadius;
    uniforms.uMaxVelocity.value = windSpeed;
    uniforms.uHeight.value = params.height;
    uniforms.uTurbulence.value = params.turbulence;
    uniforms.uRotationDir.value = params.rotationDirection;
    uniforms.uTime.value = time;
    uniforms.uDeltaTime.value = delta;
    
    // Run update compute
    (gl as unknown as { compute: (compute: unknown) => void }).compute(computeSystem.computeUpdate);
  });
  
  if (!computeSystem || !material) return null;
  
  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      count={computeSystem.count}
    />
  );
}

/**
 * Main debris system component - renders all particle layers
 */
export default function DebrisSystem({ params, tornadoPosition }: DebrisSystemProps) {
  return (
    <group name="debris-system">
      {DEBRIS_LAYERS.map((layer) => (
        <DebrisLayerMesh
          key={layer.name}
          layer={layer}
          params={params}
          tornadoPosition={tornadoPosition}
        />
      ))}
    </group>
  );
}
