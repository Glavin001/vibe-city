"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, StatsGl } from "@react-three/drei";
import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import * as THREE from "three";
import { Geometry, Base, Subtraction, type CSGGeometryRef } from "@react-three/csg";
import InstancedWalls from "@/components/decals/InstancedWalls";
import DecalBatcher, { type DecalBatcherRef, MAX_DECALS } from "@/components/decals/DecalBatcher";
import { DECAL_SIZE, HOLE_RADIUS, WALL_COUNT_X, WALL_SPACING } from "@/components/decals/constants";
import { DecalGeometry } from "three/examples/jsm/geometries/DecalGeometry.js";

type Hole = {
  id: number;
  position: THREE.Vector3;
  rotation: THREE.Euler;
  radius: number;
  depth: number;
};

import { forwardRef } from "react";

type CSGGeometryLike = CSGGeometryRef | null;

const CSGWallInstance = forwardRef<THREE.Mesh, { instanceId: number; matrix: THREE.Matrix4; holes: Hole[]; onGeometryRef?: (r: CSGGeometryLike) => void }>(
  function CSGWallInstance({ instanceId, matrix, holes, onGeometryRef }, ref) {
  return (
    <mesh ref={ref} matrixAutoUpdate={false} matrix={matrix} userData={{ instanceId }}>
      {/* Material should be on the mesh per @react-three/csg docs */}
      <meshStandardMaterial color="#89919a" metalness={0.0} roughness={0.85} />
        <Geometry computeVertexNormals ref={onGeometryRef as React.Ref<CSGGeometryRef>}>
        <Base>
          <boxGeometry args={[1.5, 1.0, 0.15]} />
        </Base>
        {holes.map((h) => (
          <Subtraction key={h.id} position={h.position.toArray()} rotation={h.rotation.toArray()}>
            {/** Cylinder axis is Y in three.js; we align Y with local normal */}
            <cylinderGeometry args={[h.radius, h.radius, h.depth, 32, 1, false]} />
          </Subtraction>
        ))}
      </Geometry>
    </mesh>
  );
});

// Removed unused CSGWallsManager

function ClickToDecalAndHole({
  wallsMesh,
  onAddDecal,
  onAddHole,
  csgGroup,
}: {
  wallsMesh: THREE.InstancedMesh | null;
  onAddDecal: (geom: THREE.BufferGeometry) => void;
  onAddHole: (
    instanceId: number,
    worldFromInstance: THREE.Matrix4,
    hitPointWorld: THREE.Vector3,
    rayDirWorld: THREE.Vector3
  ) => void;
  csgGroup: THREE.Group | null;
}) {
  const { camera, gl } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const zAxis = useMemo(() => new THREE.Vector3(0, 0, 1), []);

  const handleClick = useCallback(
    (event: MouseEvent) => {
      if (!wallsMesh) return;

      const rect = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -(((event.clientY - rect.top) / rect.height) * 2 - 1)
      );

      raycaster.setFromCamera(ndc, camera);
      // Intersect either existing instanced mesh or already-converted CSG overlay
      const targets: THREE.Object3D[] = [];
      if (wallsMesh) targets.push(wallsMesh);
      if (csgGroup) targets.push(csgGroup);
      // Recurse so children of the CSG group are raycasted
      const hits = raycaster.intersectObjects(targets, true);
      if (hits.length === 0) return;

      const hit = hits[0];
      let instanceId: number | undefined = hit.instanceId;
      const worldFromInstance = new THREE.Matrix4();
      let decalTargetMesh: THREE.Mesh | null = null;

      // Try to locate an overlay mesh by walking ancestors for userData.instanceId
      let overlayMesh: (THREE.Mesh & { userData: { instanceId?: number } }) | null = null;
      {
        let o: THREE.Object3D | null = hit.object;
        while (o && o !== wallsMesh && o !== csgGroup) {
          const maybeMesh = o as THREE.Object3D as Partial<THREE.Mesh> & { userData?: { instanceId?: number } };
          if ((maybeMesh as unknown as { isMesh?: boolean }).isMesh && maybeMesh.userData && maybeMesh.userData.instanceId !== undefined) {
            overlayMesh = maybeMesh as unknown as THREE.Mesh & { userData: { instanceId?: number } };
            break;
          }
          o = o.parent;
        }
      }

      if (overlayMesh) {
        instanceId = overlayMesh.userData.instanceId as number;
        overlayMesh.updateMatrixWorld();
        worldFromInstance.copy(overlayMesh.matrixWorld);
        decalTargetMesh = overlayMesh;
      } else if (hit.object === wallsMesh && instanceId !== undefined) {
        const tmpMat4 = new THREE.Matrix4();
        wallsMesh.getMatrixAt(instanceId, tmpMat4);
        worldFromInstance.multiplyMatrices(wallsMesh.matrixWorld, tmpMat4);
        // Decal target is the original geometry proxy
        const wallGeom = wallsMesh.geometry;
        const wallMat = wallsMesh.material as THREE.Material;
        const proxyMesh = new THREE.Mesh(wallGeom, wallMat);
        proxyMesh.matrixAutoUpdate = false;
        proxyMesh.matrix.copy(worldFromInstance);
        proxyMesh.updateMatrixWorld(true);
        decalTargetMesh = proxyMesh;
      } else {
        return;
      }
      if (instanceId === undefined) return;

      // Normal in world (for decal roll)
      const normalMatrix = new THREE.Matrix3();
      normalMatrix.getNormalMatrix(worldFromInstance);
      const normalWorld = (hit.face?.normal ?? zAxis).clone().applyMatrix3(normalMatrix).normalize();

      // Decal rotation: align z to normal
      const baseQuat = new THREE.Quaternion().setFromUnitVectors(zAxis, normalWorld);
      const euler = new THREE.Euler().setFromQuaternion(baseQuat, "XYZ");
      euler.z += Math.random() * Math.PI * 2.0;

      // Build decal using the correct target mesh (overlay if present)
      if (!decalTargetMesh) return;
      const target = decalTargetMesh;
      const pointForDecal = hit.point.clone().add(normalWorld.clone().multiplyScalar(0.0005));
      const dGeom = new (DecalGeometry as unknown as new (
        mesh: THREE.Mesh,
        position: THREE.Vector3,
        orientation: THREE.Euler,
        size: THREE.Vector3
      ) => THREE.BufferGeometry)(target, pointForDecal, euler, DECAL_SIZE);
      onAddDecal(dGeom);

      // Pass ray direction in world space for ray-aligned cut
      onAddHole(
        instanceId,
        worldFromInstance,
        hit.point.clone(),
        raycaster.ray.direction.clone().normalize()
      );
    },
    [wallsMesh, csgGroup, camera, gl, raycaster, zAxis, onAddDecal, onAddHole]
  );

  useEffect(() => {
    const canvas = gl.domElement;
    canvas.addEventListener("pointerdown", handleClick);
    return () => canvas.removeEventListener("pointerdown", handleClick);
  }, [gl, handleClick]);

  return null;
}

function Scene({ onDecalCountChange }: { onDecalCountChange: (count: number) => void }) {
  const [wallsMesh, setWallsMesh] = useState<THREE.InstancedMesh | null>(null);
  const decalBatcherRef = useRef<DecalBatcherRef>(null);
  const [csgApi, setCsgApi] = useState<{
    addHoleAt: (instanceId: number, worldFromInstance: THREE.Matrix4, hitPointWorld: THREE.Vector3, rayDirWorld: THREE.Vector3) => void;
    group: THREE.Group | null;
  } | null>(null);

  const handleAddDecal = useCallback((geom: THREE.BufferGeometry) => {
    if (decalBatcherRef.current?.addDecal) {
      decalBatcherRef.current.addDecal(geom);
    }
  }, []);

  const handleCsgManagerMount = useCallback((api: { addHoleAt: (instanceId: number, worldFromInstance: THREE.Matrix4, hitPointWorld: THREE.Vector3, rayDirWorld: THREE.Vector3) => void; group: THREE.Group | null }) => {
    setCsgApi(api);
  }, []);

  return (
    <>
      <StatsGl className="stats-gl fixed top-20 left-4" />

      <ambientLight intensity={0.35} />
      <directionalLight position={[5, 8, 3]} intensity={1.1} />

      <OrbitControls
        makeDefault
        enableDamping
        target={[WALL_COUNT_X * WALL_SPACING * 0.25, 1, 0]}
      />

      <InstancedWalls onWallsReady={setWallsMesh} />

      <DecalBatcher ref={decalBatcherRef} onDecalCountChange={onDecalCountChange} />

      {/* Click interaction */}
      <ClickToDecalAndHole
        wallsMesh={wallsMesh}
        onAddDecal={handleAddDecal}
        onAddHole={(id, m, p, n) => csgApi?.addHoleAt(id, m, p, n)}
        csgGroup={csgApi?.group ?? null}
      />

      {/* CSG dynamic walls overlay */}
      {/* Adapter to expose addHoleAt to Scene via state */}
      <CSGWallsManagerWrapper wallsMesh={wallsMesh} onMount={handleCsgManagerMount} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow={false}>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color="#22262b" metalness={0.0} roughness={1.0} />
      </mesh>

      <gridHelper args={[200, 200, 0x666666, 0x333333]} />
    </>
  );
}

function CSGWallsManagerWrapper({
  wallsMesh,
  onMount,
}: {
  wallsMesh: THREE.InstancedMesh | null;
  onMount: (api: { addHoleAt: (instanceId: number, worldFromInstance: THREE.Matrix4, hitPointWorld: THREE.Vector3, rayDirWorld: THREE.Vector3) => void; group: THREE.Group | null }) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const meshByInstanceRef = useRef<Map<number, THREE.Mesh>>(new Map());
  const geometryApiByInstanceRef = useRef<Map<number, { update: () => void }>>(new Map());

  const [holesByInstance, setHolesByInstance] = useState<Map<number, Hole[]>>(new Map());
  const [matricesByInstance, setMatricesByInstance] = useState<Map<number, THREE.Matrix4>>(new Map());
  const holeSeqByInstanceRef = useRef<Map<number, number>>(new Map());

  const addHoleAt = useCallback(
    (instanceId: number, worldFromInstance: THREE.Matrix4, hitPointWorld: THREE.Vector3, rayDirWorld: THREE.Vector3) => {
      const inv = new THREE.Matrix4().copy(worldFromInstance).invert();
      const pointLocal = hitPointWorld.clone().applyMatrix4(inv);
      // Transform ray direction to local space and normalize
      const dirLocal = rayDirWorld.clone().transformDirection(inv).normalize();
      const yAxis = new THREE.Vector3(0, 1, 0);
      const quat = new THREE.Quaternion().setFromUnitVectors(yAxis, dirLocal);
      const euler = new THREE.Euler().setFromQuaternion(quat, "XYZ");

      // Compute dynamic depth to fully exit the slab thickness (0.15) along local Z
      const thickness = 0.15;
      const eps = 1e-4;
      const denom = Math.max(eps, Math.abs(dirLocal.z));
      const pathInside = thickness / denom;
      const margin = 0.02;
      const depth = pathInside + margin;

      // Center the cutter along the ray direction so it fully exits the slab
      const centerOffset = dirLocal.clone().multiplyScalar(depth * 0.5);
      const holeCenter = pointLocal.clone().add(centerOffset);

      setHolesByInstance((prev) => {
        const next = new Map(prev);
        const list = next.get(instanceId) ?? [];
        const seq = (holeSeqByInstanceRef.current.get(instanceId) ?? 0) + 1;
        holeSeqByInstanceRef.current.set(instanceId, seq);
        list.push({ id: seq, position: holeCenter, rotation: euler, radius: HOLE_RADIUS, depth });
        next.set(instanceId, list);
        return next;
      });
      // Trigger CSG update immediately if we have the API already
      const api = geometryApiByInstanceRef.current.get(instanceId);
      if (api) {
        // Schedule on next frame to avoid conflicts with current commit/raycast
        requestAnimationFrame(() => api.update());
      }

      setMatricesByInstance((prev) => {
        if (prev.has(instanceId)) return prev;
        const next = new Map(prev);
        next.set(instanceId, worldFromInstance.clone());
        return next;
      });

      if (wallsMesh) {
        const tmp = new THREE.Matrix4();
        wallsMesh.getMatrixAt(instanceId, tmp);
        const scl = new THREE.Vector3();
        const rot = new THREE.Quaternion();
        tmp.decompose(new THREE.Vector3(), rot, scl);
        const off = new THREE.Matrix4().compose(new THREE.Vector3(1e6, -1e6, 1e6), rot, scl);
        wallsMesh.setMatrixAt(instanceId, off);
        wallsMesh.instanceMatrix.needsUpdate = true;
      }
    },
    [wallsMesh]
  );

  useEffect(() => {
    onMount({ addHoleAt, group: groupRef.current });
  }, [onMount, addHoleAt]);

  return (
    <group ref={groupRef}>
      {Array.from(holesByInstance.entries()).map(([instanceId, holes]) => {
        const matrix = matricesByInstance.get(instanceId);
        if (!matrix) return null;
        return (
          <CSGWallInstance
            key={instanceId}
            instanceId={instanceId}
            matrix={matrix}
            holes={holes}
            ref={(mesh) => {
              if (mesh) meshByInstanceRef.current.set(instanceId, mesh);
            }}
            onGeometryRef={(api) => {
              if (api) geometryApiByInstanceRef.current.set(instanceId, api as { update: () => void });
            }}
          />
        );
      })}
    </group>
  );
}

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
        <b>Click</b> to place a decal and subtract a cylindrical hole.
      </div>
      <div>
        Decals batched: <code style={{ background: "transparent", color: "#b2e3ff" }}>{decalCount}</code> /{" "}
        <code style={{ background: "transparent", color: "#b2e3ff" }}>{MAX_DECALS}</code>
      </div>
      <div>Proof-of-concept: per-instance CSG replaces the clicked instanced wall.</div>
    </div>
  );
}

export default function DecalsCSGDemoPage() {
  const [decalCount, setDecalCount] = useState(0);
  return (
    <div style={{ width: "100vw", height: "100vh", margin: 0 }}>
      <Canvas
        camera={{ position: [8, 6, 14], fov: 60, near: 0.1, far: 200 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0 }}
      >
        <color attach="background" args={["#15181d"]} />
        <Scene onDecalCountChange={setDecalCount} />
      </Canvas>
      <HUD decalCount={decalCount} />
    </div>
  );
}


