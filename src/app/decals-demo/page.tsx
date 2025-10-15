"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, StatsGl } from "@react-three/drei";
import { useRef, useState, useCallback, useMemo, forwardRef, useImperativeHandle, useEffect } from "react";
import * as THREE from "three";
import { DecalGeometry } from "three/examples/jsm/geometries/DecalGeometry.js";

/**
 * -----------------------------------------------------------------------------
 * Production-minded constants
 * -----------------------------------------------------------------------------
 */
const WALL_COUNT_X = 20;
const WALL_COUNT_Z = 10;
const WALL_SPACING = 2.0;

const MAX_DECALS = 2000;
// Realistic bullet hole size: ~5cm diameter (walls are 1.5m x 1m, so 0.05 units = 5cm)
const DECAL_SIZE = new THREE.Vector3(0.05, 0.05, 0.02);
const DECAL_ALPHA_TEST = 0.5;
const DECAL_POLY_OFFSET = -4;

const AVG_VERTS_PER_DECAL = 128;
const AVG_INDICES_PER_DECAL = 256;

const VERT_BUDGET = MAX_DECALS * AVG_VERTS_PER_DECAL;
const INDEX_BUDGET = MAX_DECALS * AVG_INDICES_PER_DECAL;

const OPTIMIZE_EVERY = 50;

/**
 * -----------------------------------------------------------------------------
 * InstancedWalls component - grid of wall boxes
 * -----------------------------------------------------------------------------
 */
function InstancedWalls({ onWallsReady }: { onWallsReady: (mesh: THREE.InstancedMesh) => void }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const INSTANCE_COUNT = WALL_COUNT_X * WALL_COUNT_Z;

  // Set up instance matrices after mesh is mounted
  useEffect(() => {
    if (!meshRef.current) return;

    const tmpMat4 = new THREE.Matrix4();
    let i = 0;
    for (let ix = 0; ix < WALL_COUNT_X; ix++) {
      for (let iz = 0; iz < WALL_COUNT_Z; iz++) {
        tmpMat4.compose(
          new THREE.Vector3(
            ix * WALL_SPACING,
            1.0 + Math.sin(ix * 0.35) * 0.5,
            (iz - WALL_COUNT_Z * 0.5) * WALL_SPACING
          ),
          new THREE.Quaternion().setFromEuler(
            new THREE.Euler(0, (ix * 0.15) % (Math.PI * 2), 0)
          ),
          new THREE.Vector3(1, 1, 1)
        );
        meshRef.current.setMatrixAt(i++, tmpMat4);
      }
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    meshRef.current.computeBoundingSphere();

    onWallsReady(meshRef.current);
  }, [onWallsReady]);

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, INSTANCE_COUNT]}>
      <boxGeometry args={[1.5, 1.0, 0.15]} />
      <meshStandardMaterial color="#89919a" metalness={0.0} roughness={0.85} />
    </instancedMesh>
  );
}

/**
 * -----------------------------------------------------------------------------
 * DecalBatcher - manages BatchedMesh for all decals
 * -----------------------------------------------------------------------------
 */
interface DecalRecord {
  geometryId: number;
}

interface DecalBatcherRef {
  addDecal: (geom: THREE.BufferGeometry) => void;
}

const DecalBatcher = forwardRef<DecalBatcherRef, { onDecalCountChange: (count: number) => void }>(
  function DecalBatcher({ onDecalCountChange }, ref) {
    const batchRef = useRef<THREE.BatchedMesh | null>(null);
    const decalRingRef = useRef<DecalRecord[]>([]);
    const removedSinceOptimizeRef = useRef(0);
    const { gl } = useThree();

    // Load bullet hole texture
    const decalMaterial = useMemo(() => {
      const textureLoader = new THREE.TextureLoader();
      const bulletTex = textureLoader.load("/decals/bullet-hole.png");
      bulletTex.colorSpace = THREE.SRGBColorSpace;
      bulletTex.anisotropy = Math.min(16, gl.capabilities.getMaxAnisotropy());

      return new THREE.MeshStandardMaterial({
        map: bulletTex,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: DECAL_POLY_OFFSET,
        alphaTest: DECAL_ALPHA_TEST,
        metalness: 0.0,
        roughness: 0.9,
      });
    }, [gl]);

    // Create BatchedMesh
    useMemo(() => {
      if (batchRef.current) return batchRef.current;

      const batch = new THREE.BatchedMesh(
        MAX_DECALS,
        VERT_BUDGET,
        INDEX_BUDGET,
        decalMaterial
      );
      // Disable frustum culling since decals are spread across the entire scene
      // and dynamically added. The bounding sphere would need constant updating.
      // Decals are cheap to render, so this is acceptable.
      batch.frustumCulled = false;
      batch.sortObjects = true;
      batchRef.current = batch;

      return batch;
    }, [decalMaterial]);

    // Expose method to add decals
    const addDecal = useCallback(
      (geom: THREE.BufferGeometry) => {
        if (!batchRef.current) return;

        const batch = batchRef.current;
        const geoId = batch.addGeometry(geom);
        const instId = batch.addInstance(geoId);

        // DecalGeometry is in world space, so identity matrix
        const identityMat = new THREE.Matrix4();
        batch.setMatrixAt(instId, identityMat);

        decalRingRef.current.push({ geometryId: geoId });

        // Ring buffer enforcement
        if (decalRingRef.current.length > MAX_DECALS) {
          const oldest = decalRingRef.current.shift();
          if (oldest) {
            batch.deleteGeometry(oldest.geometryId);
            removedSinceOptimizeRef.current++;

            if (removedSinceOptimizeRef.current >= OPTIMIZE_EVERY) {
              batch.optimize();
              removedSinceOptimizeRef.current = 0;
            }
          }
        }

        onDecalCountChange(decalRingRef.current.length);
      },
      [onDecalCountChange]
    );

    // Expose addDecal method via ref
    useImperativeHandle(ref, () => ({
      addDecal,
    }), [addDecal]);

    return <primitive object={batchRef.current} />;
  }
);

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
      <StatsGl className="stats-gl" />

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

