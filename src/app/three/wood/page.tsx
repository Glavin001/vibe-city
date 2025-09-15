"use client";

import { Environment, OrbitControls, Text } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense, useMemo } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import {
  Finishes,
  type WoodFinish,
  WoodGenuses,
  type WoodGenus,
  WoodNodeMaterial,
} from "three/examples/jsm/materials/WoodNodeMaterial.js";

function getGridPosition(
  woodIndex: number,
  finishIndex: number,
): [number, number, number] {
  return [
    0,
    (finishIndex - Finishes.length / 2) * 1,
    (woodIndex - WoodGenuses.length / 2 + 0.45) * 1,
  ];
}


function WoodBlocks() {
  const geometry = useMemo(() => new RoundedBoxGeometry(0.125, 0.9, 0.9, 10, 0.02), []);
  return WoodGenuses.flatMap((genus, x) =>
    Finishes.map((finish, y) => {
      const material = WoodNodeMaterial.fromPreset(genus, finish);
      material.transformationMatrix = new THREE.Matrix4().setPosition(
        new THREE.Vector3(-0.1, 0, Math.random()),
      );
      return (
        <mesh
          key={`${genus}-${finish}`}
          geometry={geometry}
          material={material}
          position={getGridPosition(x, y)}
        />
      );
    }),
  );
}

function Labels() {
  return (
    <>
      {Finishes.map((finish, y) => (
        <Text
          key={`finish-${finish}`}
          position={getGridPosition(-1, y)}
          fontSize={0.1}
          color="black"
          rotation={[0, -Math.PI / 2, 0]}
        >
          {finish}
        </Text>
      ))}
      {WoodGenuses.map((genus, x) => (
        <Text
          key={`genus-${genus}`}
          position={getGridPosition(x, -1)}
          fontSize={0.1}
          color="black"
          rotation={[0, -Math.PI / 2, 0]}
        >
          {genus}
        </Text>
      ))}
    </>
  );
}

function WoodScene() {
  return (
    <group rotation={[0, 0, -Math.PI / 2]} position={[0, 0, 0.548]}>
      <WoodBlocks />
      <Labels />
    </group>
  );
}

export default function WoodPage() {
  return (
    <div className="min-h-screen bg-gray-900">
      <div className="w-full h-[600px]">
        <Canvas camera={{ position: [-0.1, 5, 0.548], fov: 75 }}>
          <Suspense fallback={null}>
            <Environment
              files="https://threejs.org/examples/textures/equirectangular/san_giuseppe_bridge_2k.hdr"
              background
            />
            <WoodScene />
            <OrbitControls target={[0, 0, 0.548]} />
          </Suspense>
        </Canvas>
      </div>
    </div>
  );
}
