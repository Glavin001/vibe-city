/**
 * Main Tornado Scene Component
 * 
 * Integrates all tornado simulation components:
 * - Volumetric funnel rendering
 * - Multi-layer debris particle system
 * - Atmospheric effects (wall cloud, ground dust, sky)
 * 
 * Also handles tornado movement and global animation state.
 */

"use client";

import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three/webgpu";
import type { TornadoParams } from "@/app/tornado/page";

// Import sub-components
import TornadoFunnel from "./TornadoFunnel";
import DebrisSystem from "./DebrisSystem";
import AtmosphereEffects from "./AtmosphereEffects";

interface TornadoSceneProps {
  params: TornadoParams;
}

/**
 * Main scene component that orchestrates all tornado elements
 */
export default function TornadoScene({ params }: TornadoSceneProps) {
  // Tornado position state - can move across the scene
  const [tornadoPosition] = useState(() => new THREE.Vector3(0, 0, 0));
  const tornadoPositionRef = useRef(tornadoPosition);
  
  // Movement state
  const movementAngle = useRef(Math.random() * Math.PI * 2);
  const pathNoiseOffset = useRef(Math.random() * 1000);
  
  // Update tornado position based on translation speed
  useFrame(({ clock }) => {
    const time = clock.getElapsedTime();
    const speed = params.translationSpeed;
    
    if (speed > 0) {
      // Add some meandering to the path using noise
      const noiseFreq = 0.1;
      const noiseAmp = 0.3;
      const pathNoise = Math.sin(time * noiseFreq + pathNoiseOffset.current) * noiseAmp;
      
      // Current movement direction with slight variation
      const currentAngle = movementAngle.current + pathNoise;
      
      // Update position
      const dx = Math.cos(currentAngle) * speed * 0.016; // Assuming ~60fps
      const dz = Math.sin(currentAngle) * speed * 0.016;
      
      tornadoPositionRef.current.x += dx;
      tornadoPositionRef.current.z += dz;
      
      // Keep tornado within bounds (loop around)
      const bounds = 2000;
      if (tornadoPositionRef.current.x > bounds) tornadoPositionRef.current.x = -bounds;
      if (tornadoPositionRef.current.x < -bounds) tornadoPositionRef.current.x = bounds;
      if (tornadoPositionRef.current.z > bounds) tornadoPositionRef.current.z = -bounds;
      if (tornadoPositionRef.current.z < -bounds) tornadoPositionRef.current.z = bounds;
    }
  });
  
  return (
    <group name="tornado-scene">
      {/* Atmospheric effects (sky, ground, wall cloud, fog) */}
      <AtmosphereEffects
        params={params}
        tornadoPosition={tornadoPositionRef.current}
      />
      
      {/* Volumetric funnel */}
      <TornadoFunnel
        params={params}
        tornadoPosition={tornadoPositionRef.current}
      />
      
      {/* Multi-layer debris particles */}
      <DebrisSystem
        params={params}
        tornadoPosition={tornadoPositionRef.current}
      />
      
      {/* Scene markers/reference objects */}
      <SceneObjects params={params} />
    </group>
  );
}

/**
 * Reference objects in the scene for scale and context
 */
function SceneObjects({ params: _params }: { params: TornadoParams }) {
  return (
    <group name="scene-objects">
      {/* Farm buildings/houses for scale reference */}
      <group position={[300, 0, 200]}>
        <House />
      </group>
      <group position={[-400, 0, -300]}>
        <House />
      </group>
      <group position={[200, 0, -500]}>
        <Barn />
      </group>
      
      {/* Trees scattered around */}
      {Array.from({ length: 20 }).map((_, i) => {
        const angle = (i / 20) * Math.PI * 2;
        const radius = 400 + (i * 31) % 600; // Deterministic positioning
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        const scale = 0.8 + ((i * 17) % 40) / 100; // Deterministic scale
        return (
          <group key={`tree-${i}-${angle.toFixed(2)}`} position={[x, 0, z]}>
            <Tree scale={scale} />
          </group>
        );
      })}
      
      {/* Power lines */}
      <PowerLines />
      
      {/* Road */}
      <Road />
    </group>
  );
}

/**
 * Simple house model
 */
function House() {
  return (
    <group>
      {/* Main building */}
      <mesh position={[0, 5, 0]} castShadow receiveShadow>
        <boxGeometry args={[15, 10, 12]} />
        <meshStandardMaterial color={0xccbbaa} roughness={0.8} />
      </mesh>
      {/* Roof */}
      <mesh position={[0, 12, 0]} rotation={[0, 0, 0]} castShadow>
        <coneGeometry args={[12, 6, 4]} />
        <meshStandardMaterial color={0x553333} roughness={0.7} />
      </mesh>
      {/* Door */}
      <mesh position={[0, 3, 6.1]}>
        <boxGeometry args={[3, 6, 0.2]} />
        <meshStandardMaterial color={0x443322} />
      </mesh>
      {/* Windows */}
      <mesh position={[-4, 5, 6.1]}>
        <boxGeometry args={[2.5, 2.5, 0.2]} />
        <meshStandardMaterial color={0x88aacc} metalness={0.3} />
      </mesh>
      <mesh position={[4, 5, 6.1]}>
        <boxGeometry args={[2.5, 2.5, 0.2]} />
        <meshStandardMaterial color={0x88aacc} metalness={0.3} />
      </mesh>
    </group>
  );
}

/**
 * Simple barn model
 */
function Barn() {
  return (
    <group>
      {/* Main building */}
      <mesh position={[0, 8, 0]} castShadow receiveShadow>
        <boxGeometry args={[25, 16, 18]} />
        <meshStandardMaterial color={0x993333} roughness={0.9} />
      </mesh>
      {/* Roof */}
      <mesh position={[0, 18, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
        <cylinderGeometry args={[13, 13, 25, 4, 1, false, Math.PI / 4, Math.PI]} />
        <meshStandardMaterial color={0x444444} roughness={0.8} />
      </mesh>
      {/* Barn doors */}
      <mesh position={[0, 6, 9.1]}>
        <boxGeometry args={[10, 12, 0.3]} />
        <meshStandardMaterial color={0x664422} />
      </mesh>
    </group>
  );
}

/**
 * Simple tree model
 */
function Tree({ scale = 1 }: { scale?: number }) {
  return (
    <group scale={scale}>
      {/* Trunk */}
      <mesh position={[0, 5, 0]} castShadow>
        <cylinderGeometry args={[1, 1.5, 10, 8]} />
        <meshStandardMaterial color={0x553311} roughness={0.9} />
      </mesh>
      {/* Foliage layers */}
      <mesh position={[0, 12, 0]} castShadow>
        <coneGeometry args={[6, 8, 8]} />
        <meshStandardMaterial color={0x224422} roughness={0.8} />
      </mesh>
      <mesh position={[0, 17, 0]} castShadow>
        <coneGeometry args={[4.5, 7, 8]} />
        <meshStandardMaterial color={0x336633} roughness={0.8} />
      </mesh>
      <mesh position={[0, 21, 0]} castShadow>
        <coneGeometry args={[3, 5, 8]} />
        <meshStandardMaterial color={0x447744} roughness={0.8} />
      </mesh>
    </group>
  );
}

/**
 * Power lines for scale reference
 */
function PowerLines() {
  const polePositions = [
    [-800, -200],
    [-400, -200],
    [0, -200],
    [400, -200],
    [800, -200],
  ];
  
  return (
    <group>
      {polePositions.map(([x, z]) => (
        <group key={`pole-${x}-${z}`} position={[x, 0, z]}>
          {/* Pole */}
          <mesh position={[0, 15, 0]} castShadow>
            <cylinderGeometry args={[0.3, 0.4, 30, 8]} />
            <meshStandardMaterial color={0x553322} roughness={0.9} />
          </mesh>
          {/* Cross arm */}
          <mesh position={[0, 28, 0]} castShadow>
            <boxGeometry args={[10, 0.5, 0.5]} />
            <meshStandardMaterial color={0x553322} roughness={0.9} />
          </mesh>
          {/* Insulators */}
          <mesh position={[-4, 28, 0]}>
            <cylinderGeometry args={[0.2, 0.2, 1, 8]} />
            <meshStandardMaterial color={0x556677} />
          </mesh>
          <mesh position={[4, 28, 0]}>
            <cylinderGeometry args={[0.2, 0.2, 1, 8]} />
            <meshStandardMaterial color={0x556677} />
          </mesh>
        </group>
      ))}
      
      {/* Wires between poles */}
      {polePositions.slice(0, -1).map(([x, z], i) => {
        const nextX = polePositions[i + 1][0];
        const midX = (x + nextX) / 2;
        const length = nextX - x;
        
        return (
          <group key={`wire-${x}-${z}`}>
            {/* Left wire */}
            <mesh position={[midX, 27, z]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.05, 0.05, length, 4]} />
              <meshStandardMaterial color={0x111111} />
            </mesh>
            {/* Right wire */}
            <mesh position={[midX, 27, z]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.05, 0.05, length, 4]} />
              <meshStandardMaterial color={0x111111} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/**
 * Road for context
 */
function Road() {
  return (
    <group>
      {/* Main road */}
      <mesh position={[0, 0.1, -200]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[20, 2000]} />
        <meshStandardMaterial color={0x333333} roughness={0.9} />
      </mesh>
      
      {/* Road markings */}
      {Array.from({ length: 30 }).map((_, i) => (
        <mesh
          key={`marking-${i * 60}`}
          position={[0, 0.15, -900 + i * 60]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[0.3, 10]} />
          <meshStandardMaterial color={0xffff00} />
        </mesh>
      ))}
      
      {/* Cross road */}
      <mesh position={[0, 0.1, 300]} rotation={[-Math.PI / 2, 0, Math.PI / 2]} receiveShadow>
        <planeGeometry args={[15, 1500]} />
        <meshStandardMaterial color={0x333333} roughness={0.9} />
      </mesh>
    </group>
  );
}
