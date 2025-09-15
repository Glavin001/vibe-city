"use client";

import React, { useRef, useState } from "react";
import { Canvas, useFrame, ThreeElements } from "@react-three/fiber";
import * as THREE from "three";

function Box(props: ThreeElements["mesh"]) {
  // This reference will give us direct access to the mesh
  const meshRef = useRef<THREE.Mesh>(null!);
  // Set up state for the hovered and active state
  const [hovered, setHover] = useState(false);
  const [active, setActive] = useState(false);

  // Subscribe this component to the render-loop, rotate the mesh every frame
  useFrame((state, delta) => (meshRef.current.rotation.x += delta));

  // Return view, these are regular three.js elements expressed in JSX
  return (
    <mesh
      {...props}
      ref={meshRef}
      scale={active ? 1.5 : 1}
      onClick={(event) => setActive(!active)}
      onPointerOver={(event) => setHover(true)}
      onPointerOut={(event) => setHover(false)}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={hovered ? "hotpink" : "#2f74c0"} />
    </mesh>
  );
}

export default function ThreePage() {
  return (
    <div className="min-h-screen bg-gray-900">
      <div className="p-8">
        <h1 className="text-4xl font-bold text-white mb-4">
          THREE.js with React Three Fiber
        </h1>
        <p className="text-gray-300 mb-8">
          Click the cubes to scale them, hover to change their color. They
          rotate automatically!
        </p>

        <div className="w-full h-[600px] bg-black rounded-lg overflow-hidden">
          <Canvas>
            <ambientLight intensity={Math.PI / 2} />
            <spotLight
              position={[10, 10, 10]}
              angle={0.15}
              penumbra={1}
              decay={0}
              intensity={Math.PI}
            />
            <pointLight
              position={[-10, -10, -10]}
              decay={0}
              intensity={Math.PI}
            />
            <Box position={[-1.2, 0, 0]} />
            <Box position={[1.2, 0, 0]} />
          </Canvas>
        </div>

        <div className="mt-8 bg-gray-800 p-6 rounded-lg">
          <h2 className="text-2xl font-bold text-white mb-4">
            Scene Features:
          </h2>
          <ul className="text-gray-300 space-y-2">
            <li>
              • <strong>Interactive Cubes:</strong> Click to scale up/down,
              hover to change color
            </li>
            <li>
              • <strong>Automatic Rotation:</strong> Cubes rotate continuously
              using useFrame hook
            </li>
            <li>
              • <strong>Lighting:</strong> Ambient light, spot light, and point
              light for realistic shading
            </li>
            <li>
              • <strong>React Integration:</strong> Full React state management
              and event handling
            </li>
          </ul>
        </div>
        <div className="mt-6 flex gap-4">
          <a
            href="/three/wood"
            className="inline-block bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
          >
            Wood Material Demo →
          </a>
          <a
            href="/"
            className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
          >
            ← Back to Home
          </a>
        </div>
      </div>
    </div>
  );
}
