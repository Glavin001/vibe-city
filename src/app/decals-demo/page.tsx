"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, StatsGl } from "@react-three/drei";
import { useRef, useState, useCallback, useMemo, useEffect } from "react";
import * as THREE from "three";
import { DecalGeometry } from "three/examples/jsm/geometries/DecalGeometry.js";
import InstancedWalls from "@/components/decals/InstancedWalls";
import DecalBatcher, { type DecalBatcherRef } from "@/components/decals/DecalBatcher";
import { DECAL_SIZE, MAX_DECALS, WALL_COUNT_X, WALL_SPACING } from "@/components/decals/constants";

/** Shared components imported */

/**
 * -----------------------------------------------------------------------------
 * ClickToDecal - handles raycasting and decal placement
 * -----------------------------------------------------------------------------
 */
function ClickToDecal({
  wallsMesh,
  onAddDecal,
}: {
  wallsMesh: THREE.InstancedMesh | null;
  onAddDecal: (geom: THREE.BufferGeometry) => void;
}) {
  const { camera, gl } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const zAxis = useMemo(() => new THREE.Vector3(0, 0, 1), []);

  const handleClick = useCallback(
    (event: MouseEvent) => {
      if (!wallsMesh) return;

      // Convert to NDC
      const rect = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -(((event.clientY - rect.top) / rect.height) * 2 - 1)
      );

      raycaster.setFromCamera(ndc, camera);

      // Raycast against walls only
      const hits = raycaster.intersectObject(wallsMesh, false);
      if (hits.length === 0) return;

      const hit = hits[0];
      if (hit.instanceId === undefined) return;

      // Get world matrix for the specific instance
      const tmpMat4 = new THREE.Matrix4();
      const worldFromInstance = new THREE.Matrix4();
      wallsMesh.getMatrixAt(hit.instanceId, tmpMat4);
      worldFromInstance.multiplyMatrices(wallsMesh.matrixWorld, tmpMat4);

      // Create surrogate mesh at instance's world transform
      const wallGeom = wallsMesh.geometry;
      const wallMat = wallsMesh.material as THREE.Material;
      const proxyMesh = new THREE.Mesh(wallGeom, wallMat);
      proxyMesh.matrixAutoUpdate = false;
      proxyMesh.matrix.copy(worldFromInstance);
      proxyMesh.updateMatrixWorld(true);

      // Transform normal to world space
      const normalMatrix = new THREE.Matrix3();
      normalMatrix.getNormalMatrix(worldFromInstance);
      const normalWorld = (hit.face?.normal ?? zAxis)
        .clone()
        .applyMatrix3(normalMatrix)
        .normalize();

      // Align projector with surface normal + random roll
      const baseQuat = new THREE.Quaternion().setFromUnitVectors(zAxis, normalWorld);
      const euler = new THREE.Euler().setFromQuaternion(baseQuat, "XYZ");
      euler.z += Math.random() * Math.PI * 2.0;

      // Create decal geometry
      const dGeom = new DecalGeometry(proxyMesh, hit.point, euler, DECAL_SIZE);

      onAddDecal(dGeom as THREE.BufferGeometry);
    },
    [wallsMesh, camera, gl, raycaster, zAxis, onAddDecal]
  );

  // Attach click listener
  useEffect(() => {
    const canvas = gl.domElement;
    canvas.addEventListener("pointerdown", handleClick);
    return () => canvas.removeEventListener("pointerdown", handleClick);
  }, [gl, handleClick]);

  return null;
}

/**
 * -----------------------------------------------------------------------------
 * Scene component
 * -----------------------------------------------------------------------------
 */
function Scene({ onDecalCountChange }: { onDecalCountChange: (count: number) => void }) {
  const [wallsMesh, setWallsMesh] = useState<THREE.InstancedMesh | null>(null);
  const decalBatcherRef = useRef<DecalBatcherRef>(null);

  const handleAddDecal = useCallback((geom: THREE.BufferGeometry) => {
    if (decalBatcherRef.current?.addDecal) {
      decalBatcherRef.current.addDecal(geom);
    }
  }, []);

  return (
    <>
      {/* Performance stats */}
      <StatsGl className="stats-gl fixed top-20 left-4" />

      {/* Lighting */}
      <ambientLight intensity={0.35} />
      <directionalLight position={[5, 8, 3]} intensity={1.1} />

      {/* Camera and controls */}
      <OrbitControls
        makeDefault
        enableDamping
        target={[WALL_COUNT_X * WALL_SPACING * 0.25, 1, 0]}
      />

      {/* Instanced walls */}
      <InstancedWalls onWallsReady={setWallsMesh} />

      {/* Decal batcher */}
      <DecalBatcher
        ref={decalBatcherRef}
        onDecalCountChange={onDecalCountChange}
      />

      {/* Click interaction */}
      <ClickToDecal wallsMesh={wallsMesh} onAddDecal={handleAddDecal} />

      {/* Ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow={false}>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color="#22262b" metalness={0.0} roughness={1.0} />
      </mesh>

      {/* Grid helper */}
      <gridHelper args={[200, 200, 0x666666, 0x333333]} />
    </>
  );
}

/**
 * -----------------------------------------------------------------------------
 * HUD overlay
 * -----------------------------------------------------------------------------
 */
function HUD({ decalCount }: { decalCount: number }) {
  return (
    <div
      style={{
        position: "fixed",
        left: "12px",
        top: "12px",
        padding: "8px 10px",
        background: "rgba(0,0,0,.55)",
        color: "#fff",
        font: "13px/1.3 system-ui, sans-serif",
        borderRadius: "6px",
        userSelect: "none",
      }}
    >
      <div>
        <b>Click</b> to shoot decals at instanced walls.
      </div>
      <div>
        Decals batched: <code style={{ background: "transparent", color: "#b2e3ff" }}>{decalCount}</code> /{" "}
        <code style={{ background: "transparent", color: "#b2e3ff" }}>{MAX_DECALS}</code>
      </div>
      <div>Tip: orbit, zoom, then click different faces.</div>
    </div>
  );
}

/**
 * -----------------------------------------------------------------------------
 * Main page component
 * -----------------------------------------------------------------------------
 */
export default function DecalsDemoPage() {
  const [decalCount, setDecalCount] = useState(0);

  return (
    <div style={{ width: "100vw", height: "100vh", margin: 0 }}>
      <Canvas
        camera={{ position: [8, 6, 14], fov: 60, near: 0.1, far: 200 }}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.0,
        }}
      >
        <color attach="background" args={["#1b1e23"]} />
        <Scene onDecalCountChange={setDecalCount} />
      </Canvas>
      <HUD decalCount={decalCount} />
    </div>
  );
}

