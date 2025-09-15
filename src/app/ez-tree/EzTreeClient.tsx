"use client";

import { useEffect, useRef, useMemo } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Tree } from "@dgreenheck/ez-tree";
import { Environment } from "./Environment";
import { setupUI } from "./setupUI";

function Scene() {
  const tree = useMemo(() => {
    const t = new Tree();
    t.loadPreset("Ash Medium");
    t.generate();
    t.castShadow = true;
    t.receiveShadow = true;
    return t;
  }, []);

  const environment = useMemo(() => new Environment(), []);
  const controls = useRef<any>(null);
  const { gl, scene, camera } = useThree();

  useEffect(() => {
    scene.fog = new THREE.FogExp2(0x94b9f8, 0.0015);
    setupUI(tree, environment, gl, scene, camera, controls.current, "Ash Medium");
  }, [tree, environment, gl, scene, camera]);

  useFrame((state) => {
    tree.update(state.clock.elapsedTime);
  });

  return (
    <>
      <primitive object={environment} />
      <primitive object={tree} />
      <OrbitControls ref={controls} />
    </>
  );
}

export default function EzTreeClient() {
  return (
    <div className="relative h-screen">
      <Canvas shadows camera={{ position: [100, 20, 0], fov: 60 }}>
        <Scene />
      </Canvas>
      <div id="ui-container" className="absolute top-0 right-0" />
      <input id="fileInput" type="file" className="hidden" />
      <a id="downloadLink" className="hidden" />
      <div className="absolute left-4 bottom-4">
        <a
          href="/"
          className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
        >
          ← Back to Home
        </a>
      </div>
    </div>
  );
}
