"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { WALL_COUNT_X, WALL_COUNT_Z, getWallTransform } from "@/components/decals/constants";

export function InstancedWalls({ onWallsReady }: { onWallsReady: (mesh: THREE.InstancedMesh) => void }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const INSTANCE_COUNT = WALL_COUNT_X * WALL_COUNT_Z;

  useEffect(() => {
    if (!meshRef.current) return;

    const tmpMat4 = new THREE.Matrix4();
    let i = 0;
    for (let ix = 0; ix < WALL_COUNT_X; ix++) {
      for (let iz = 0; iz < WALL_COUNT_Z; iz++) {
        const { position, rotation, scale } = getWallTransform(ix, iz);
        tmpMat4.compose(position, new THREE.Quaternion().setFromEuler(rotation), scale);
        meshRef.current.setMatrixAt(i++, tmpMat4);
      }
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    meshRef.current.computeBoundingSphere();

    onWallsReady(meshRef.current);
  }, [onWallsReady]);

  const args: [THREE.BufferGeometry | undefined, THREE.Material | THREE.Material[] | undefined, number] = [
    undefined,
    undefined,
    INSTANCE_COUNT,
  ];

  return (
    <instancedMesh ref={meshRef} args={args}>
      <boxGeometry args={[1.5, 1.0, 0.15]} />
      <meshStandardMaterial color="#89919a" metalness={0.0} roughness={0.85} />
    </instancedMesh>
  );
}

export default InstancedWalls;


