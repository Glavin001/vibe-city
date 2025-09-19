"use client";

import { Environment, OrbitControls, StatsGl } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Suspense, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { GrassField } from "./GrassField";
import { createHeightmapData, type HeightmapData } from "./heightmap";

function Terrain({ heightmap }: { heightmap: HeightmapData }) {
  const geometry = useMemo(() => {
    const segments = 256;
    const geo = new THREE.PlaneGeometry(heightmap.dims, heightmap.dims, segments, segments);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = heightmap.getHeight(x, z);
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
  }, [heightmap]);

  return (
    <mesh geometry={geometry} receiveShadow castShadow={false}>
      <meshStandardMaterial color="#4a6a3b" roughness={0.85} metalness={0.1} />
    </mesh>
  );
}

function PlayerMarker({
  heightmap,
  playerPosition,
}: {
  heightmap: HeightmapData;
  playerPosition: MutableRefObject<THREE.Vector3>;
}) {
  const markerRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() * 0.25;
    const radius = heightmap.dims * 0.22;
    const x = Math.cos(t) * radius;
    const z = Math.sin(t * 0.8) * radius;
    const y = heightmap.getHeight(x, z) + 1.8;
    playerPosition.current.set(x, y, z);
    if (markerRef.current) {
      markerRef.current.position.copy(playerPosition.current);
    }
  });

  return (
    <mesh ref={markerRef} castShadow>
      <sphereGeometry args={[1.5, 32, 32]} />
      <meshStandardMaterial color="#ffddaa" roughness={0.4} metalness={0.15} />
    </mesh>
  );
}

export default function GrassV3Demo() {
  const heightmap = useMemo(() => createHeightmapData({ size: 256, dims: 320, height: 18, offset: 9 }), []);
  const playerPosition = useRef(new THREE.Vector3(0, heightmap.getHeight(0, 0) + 1.8, 0));

  return (
    <Canvas shadows camera={{ position: [45, 32, 45], fov: 45 }}>
      <Suspense fallback={null}>
        <color attach="background" args={["#8fc5ff"]} />
        <fog attach="fog" args={["#8fc5ff", 80, 260]} />
        <hemisphereLight intensity={0.6} groundColor="#2f4030" />
        <directionalLight
          position={[70, 90, 30]}
          intensity={1.35}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-near={10}
          shadow-camera-far={220}
          shadow-camera-left={-80}
          shadow-camera-right={80}
          shadow-camera-top={80}
          shadow-camera-bottom={-80}
        />

        <Terrain heightmap={heightmap} />
        <GrassField heightmap={heightmap} playerPosition={playerPosition} />
        <PlayerMarker heightmap={heightmap} playerPosition={playerPosition} />

        <Environment preset="sunset" />
        <OrbitControls makeDefault maxPolarAngle={Math.PI * 0.5} target={[0, 6, 0]} />
      </Suspense>
      <StatsGl className="absolute top-0 left-0" />
    </Canvas>
  );
}
