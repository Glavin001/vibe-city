"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { Canvas, extend, useFrame } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { BoxGeometry, Color, MeshNormalMaterial } from "three";
import { InstancedMesh2 } from "@three.ez/instanced-mesh";

// Make InstancedMesh2 available as a JSX intrinsic element: <instancedMesh2 />
extend({ InstancedMesh2 });

function InstancedBoxes() {
  const ref = useRef<InstancedMesh2>(null);

  const geometry = useMemo(() => new BoxGeometry(1, 1, 1), []);
  const material = useMemo(() => new MeshNormalMaterial({}), []);

  useFrame(() => {
    if (!ref.current || ref.current.instancesCount >= 200000) return;
    ref.current.addInstances(100, (obj) => {
      obj.position
        .setX(Math.random() * 10000 - 5000)
        .setY(Math.random() * 10000 - 5000)
        .setZ(Math.random() * 10000 - 5000);
      obj.scale.random().multiplyScalar(Math.random() * 10 + 5);
      obj.quaternion.random();
    });
  });

  useEffect(() => {
    if (!ref.current) return;
    ref.current.computeBVH();
  }, []);

  const handleOnClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    if (!ref.current) return;
    const { instanceId } = e;
    if (instanceId === undefined || instanceId === null) return;
    ref.current.setVisibilityAt(instanceId, false);
  }, []);

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: R3F 3D object needs onClick for raycast selection */}
      <instancedMesh2 ref={ref} args={[geometry, material]} onClick={handleOnClick} />
    </>
  );
}

export default function InstancedMesh2Demo() {
  return (
    <div className="w-full h-full">
      <Canvas camera={{ position: [0, 0, 100], near: 0.1, far: 50000 }}>
        <color attach="background" args={[new Color(0x0b1020)]} />
        <ambientLight intensity={0.5} />
        <pointLight position={[50, 50, 50]} intensity={2} />
        <InstancedBoxes />
        <OrbitControls makeDefault />
      </Canvas>
    </div>
  );
}


