"use client";

import { useCallback, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { HeightmapData } from "./heightmap";
import { createGrassGeometry } from "./geometry";
import { GrassV3Material } from "./GrassMaterial";

const NUM_GRASS = (32 * 32) * 3;
const GRASS_SEGMENTS_LOW = 1;
const GRASS_SEGMENTS_HIGH = 6;
const GRASS_VERTICES_LOW = (GRASS_SEGMENTS_LOW + 1) * 2;
const GRASS_VERTICES_HIGH = (GRASS_SEGMENTS_HIGH + 1) * 2;
const GRASS_LOD_DIST = 18;
const GRASS_MAX_DIST = 110;
const GRASS_PATCH_SIZE = 10;
const GRASS_WIDTH = 0.1;
const GRASS_HEIGHT = 1.5;
const PATCH_RADIUS = 16;

interface GrassFieldProps {
  heightmap: HeightmapData;
  playerPosition: MutableRefObject<THREE.Vector3>;
}

export function GrassField({ heightmap, playerPosition }: GrassFieldProps) {
  const groupRef = useRef<THREE.Group>(null);
  const lowMeshes = useRef<THREE.Mesh[]>([]);
  const highMeshes = useRef<THREE.Mesh[]>([]);

  const geometryLow = useMemo(
    () =>
      createGrassGeometry({
        segments: GRASS_SEGMENTS_LOW,
        numInstances: NUM_GRASS,
        patchSize: GRASS_PATCH_SIZE,
      }),
    [],
  );

  const geometryHigh = useMemo(
    () =>
      createGrassGeometry({
        segments: GRASS_SEGMENTS_HIGH,
        numInstances: NUM_GRASS,
        patchSize: GRASS_PATCH_SIZE,
        seed: 4242,
      }),
    [],
  );

  const materialLow = useMemo(() => {
    const mat = new GrassV3Material({ color: 0xffffff });
    mat.alphaTest = 0.5;
    mat.transparent = false;
    mat.setVec2("grassSize", new THREE.Vector2(GRASS_WIDTH, GRASS_HEIGHT));
    mat.setVec4(
      "grassParams",
      new THREE.Vector4(GRASS_SEGMENTS_LOW, GRASS_VERTICES_LOW, heightmap.height, heightmap.offset),
    );
    mat.setVec4("grassDraw", new THREE.Vector4(GRASS_LOD_DIST, GRASS_MAX_DIST, 0, 0));
    mat.setTexture("heightmap", heightmap.texture);
    mat.setVec4(
      "heightParams",
      new THREE.Vector4(heightmap.dims, heightmap.dims, heightmap.height, heightmap.offset),
    );
    mat.setVec3("grassLODColour", new THREE.Vector3(0, 0, 1));
    return mat;
  }, [heightmap]);

  const materialHigh = useMemo(() => {
    const mat = new GrassV3Material({ color: 0xffffff });
    mat.alphaTest = 0.5;
    mat.transparent = false;
    mat.setVec2("grassSize", new THREE.Vector2(GRASS_WIDTH, GRASS_HEIGHT));
    mat.setVec4(
      "grassParams",
      new THREE.Vector4(GRASS_SEGMENTS_HIGH, GRASS_VERTICES_HIGH, heightmap.height, heightmap.offset),
    );
    mat.setVec4("grassDraw", new THREE.Vector4(GRASS_LOD_DIST, GRASS_MAX_DIST, 0, 0));
    mat.setTexture("heightmap", heightmap.texture);
    mat.setVec4(
      "heightParams",
      new THREE.Vector4(heightmap.dims, heightmap.dims, heightmap.height, heightmap.offset),
    );
    mat.setVec3("grassLODColour", new THREE.Vector3(1, 0, 0));
    return mat;
  }, [heightmap]);

  const frustum = useMemo(() => new THREE.Frustum(), []);
  const projMatrix = useMemo(() => new THREE.Matrix4(), []);
  const cameraPosXZ = useMemo(() => new THREE.Vector3(), []);
  const baseCell = useMemo(() => new THREE.Vector3(), []);
  const patchCenter = useMemo(() => new THREE.Vector3(), []);
  const aabb = useMemo(() => new THREE.Box3(), []);
  const patchSizeVec = useMemo(() => new THREE.Vector3(), []);

  const createMesh = useCallback(
    (lod: "low" | "high") => {
      const geo = lod === "low" ? geometryLow : geometryHigh;
      const mat = lod === "low" ? materialLow : materialHigh;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.visible = false;
      mesh.matrixAutoUpdate = true;
      if (groupRef.current) {
        groupRef.current.add(mesh);
      }
      if (lod === "low") {
        lowMeshes.current.push(mesh);
      } else {
        highMeshes.current.push(mesh);
      }
      return mesh;
    },
    [geometryLow, geometryHigh, materialLow, materialHigh],
  );

  useFrame(({ camera, clock }) => {
    const time = clock.getElapsedTime();
    materialLow.setFloat("time", time);
    materialHigh.setFloat("time", time);

    materialLow.setMatrix("viewMatrixInverse", camera.matrixWorld);
    materialHigh.setMatrix("viewMatrixInverse", camera.matrixWorld);

    materialLow.setVec3("playerPos", playerPosition.current);
    materialHigh.setVec3("playerPos", playerPosition.current);

    projMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projMatrix);

    cameraPosXZ.set(camera.position.x, 0, camera.position.z);

    baseCell.copy(camera.position);
    baseCell.divideScalar(GRASS_PATCH_SIZE);
    baseCell.floor();
    baseCell.multiplyScalar(GRASS_PATCH_SIZE);

    patchSizeVec.set(GRASS_PATCH_SIZE, heightmap.height * 2 + 40, GRASS_PATCH_SIZE);

    for (const mesh of lowMeshes.current) {
      mesh.visible = false;
    }
    for (const mesh of highMeshes.current) {
      mesh.visible = false;
    }

    const availableLow = [...lowMeshes.current];
    const availableHigh = [...highMeshes.current];

    for (let x = -PATCH_RADIUS; x <= PATCH_RADIUS; x++) {
      for (let z = -PATCH_RADIUS; z <= PATCH_RADIUS; z++) {
        patchCenter.set(
          baseCell.x + x * GRASS_PATCH_SIZE,
          heightmap.getHeight(baseCell.x + x * GRASS_PATCH_SIZE, baseCell.z + z * GRASS_PATCH_SIZE),
          baseCell.z + z * GRASS_PATCH_SIZE,
        );

        aabb.setFromCenterAndSize(patchCenter, patchSizeVec);
        const distToCell = aabb.distanceToPoint(cameraPosXZ);
        if (distToCell > GRASS_MAX_DIST) {
          continue;
        }

        if (!frustum.intersectsBox(aabb)) {
          continue;
        }

        let mesh: THREE.Mesh | undefined;
        if (distToCell > GRASS_LOD_DIST) {
          mesh = availableLow.pop();
          if (!mesh) {
            mesh = createMesh("low") ?? undefined;
          }
        } else {
          mesh = availableHigh.pop();
          if (!mesh) {
            mesh = createMesh("high") ?? undefined;
          }
        }

        if (!mesh) {
          continue;
        }

        mesh.position.set(patchCenter.x, 0, patchCenter.z);
        mesh.visible = true;
      }
    }
  });

  return <group ref={groupRef} />;
}
