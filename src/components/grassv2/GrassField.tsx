"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import * as THREE from "three";
import {
  getTerrainHeight,
  makeGroundGeometry as makeGroundGeometryLib,
} from "@/lib/terrain/height";
import { Grass } from "./Grass";

type CenterCoord = { x: number; z: number };

type TileState = {
  id: number;
  gridX: number;
  gridZ: number;
  tileX: number;
  tileZ: number;
  origin: THREE.Vector2;
  seed: number;
  ringIndex: number;
  ringCap: number;
  drawCount: number;
  joints: number;
  bladeHeight: number;
  useInteract: boolean;
  useCards: boolean;
  debugTip?: THREE.Color;
  debugBottom?: THREE.Color;
};

type ValueStore<T> = {
  get: () => T;
  set: (value: T) => void;
  subscribe: (listener: () => void) => () => void;
};

function createStore<T>(
  initial: T,
  equals: (a: T, b: T) => boolean = Object.is,
): ValueStore<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next: T) => {
      if (equals(value, next)) return;
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function createInitialTileStates({
  totalTiles,
  center,
  tileSize,
  halfTiles,
  originCache,
}: {
  totalTiles: number;
  center: CenterCoord;
  tileSize: number;
  halfTiles: number;
  originCache: Map<string, THREE.Vector2>;
}): TileState[] {
  const states: TileState[] = [];
  for (let gz = 0; gz < totalTiles; gz++) {
    for (let gx = 0; gx < totalTiles; gx++) {
      const tileX = center.x - halfTiles + gx;
      const tileZ = center.z - halfTiles + gz;
      const key = `${tileX}:${tileZ}`;
      const originX = (tileX + 0.5) * tileSize;
      const originZ = (tileZ + 0.5) * tileSize;
      let origin = originCache.get(key);
      if (!origin) {
        origin = new THREE.Vector2(originX, originZ);
        originCache.set(key, origin);
      } else if (origin.x !== originX || origin.y !== originZ) {
        origin.set(originX, originZ);
      }
      states.push({
        id: states.length,
        gridX: gx,
        gridZ: gz,
        tileX,
        tileZ,
        origin,
        seed: originX * 13.37 + originZ * 97.1,
        ringIndex: 0,
        ringCap: 0,
        drawCount: 0,
        joints: 0,
        bladeHeight: 1,
        useInteract: false,
        useCards: false,
      });
    }
  }
  return states;
}

function updateTileStates({
  states,
  center,
  halfTiles,
  tileSize,
  rings,
  maxCapacity,
  maxGlobalInstances,
  debug,
  originCache,
}: {
  states: TileState[];
  center: CenterCoord;
  halfTiles: number;
  tileSize: number;
  rings: RingConfig[];
  maxCapacity: number;
  maxGlobalInstances: number;
  debug: boolean;
  originCache: Map<string, THREE.Vector2>;
}) {
  if (states.length === 0) return;
  const area = tileSize * tileSize;
  const activeKeys = new Set<string>();
  const ringBuckets = rings.map(() => ({ tiles: [] as TileState[], sum: 0 }));
  let totalInstances = 0;

  for (const tile of states) {
    const tileX = center.x - halfTiles + tile.gridX;
    const tileZ = center.z - halfTiles + tile.gridZ;
    tile.tileX = tileX;
    tile.tileZ = tileZ;
    const key = `${tileX}:${tileZ}`;
    activeKeys.add(key);
    const originX = (tileX + 0.5) * tileSize;
    const originZ = (tileZ + 0.5) * tileSize;
    let origin = originCache.get(key);
    if (!origin) {
      origin = new THREE.Vector2(originX, originZ);
      originCache.set(key, origin);
    } else if (origin.x !== originX || origin.y !== originZ) {
      origin.set(originX, originZ);
    }
    tile.origin = origin;
    tile.seed = originX * 13.37 + originZ * 97.1;

    const dx = Math.abs(tileX - center.x);
    const dz = Math.abs(tileZ - center.z);
    let ringIndex = rings.length - 1;
    for (let r = 0; r < rings.length; r++) {
      if (Math.max(dx, dz) <= rings[r].maxDistanceTiles) {
        ringIndex = r;
        break;
      }
    }
    const cfg = rings[ringIndex];
    tile.ringIndex = ringIndex;
    tile.useInteract = !!cfg.useInteract;
    tile.joints = cfg.joints;
    tile.bladeHeight = cfg.bladeHeight ?? 1.0;
    tile.useCards = ringIndex >= rings.length - 1;

    const ringCap = Math.min(maxCapacity, cfg.maxPerTile ?? maxCapacity);
    tile.ringCap = ringCap;
    const baseCount = Math.max(0, Math.floor(area * cfg.densityPerUnit2));
    const drawCount = Math.min(ringCap, baseCount);
    tile.drawCount = drawCount;

    const bucket = ringBuckets[ringIndex];
    bucket.tiles.push(tile);
    bucket.sum += drawCount;
    totalInstances += drawCount;
  }

  if (originCache.size > activeKeys.size) {
    for (const key of originCache.keys()) {
      if (!activeKeys.has(key)) originCache.delete(key);
    }
  }

  const MAX_GLOBAL_INSTANCES = Math.max(1, maxGlobalInstances | 0);
  if (totalInstances > MAX_GLOBAL_INSTANCES) {
    const remaining = MAX_GLOBAL_INSTANCES;
    for (let idx = rings.length - 1; idx >= 0; idx--) {
      if (totalInstances <= remaining) break;
      const bucket = ringBuckets[idx];
      if (bucket.sum <= 0) continue;
      const over = totalInstances - remaining;
      const bucketSum = bucket.tiles.reduce(
        (sum, tile) => sum + tile.drawCount,
        0,
      );
      if (bucketSum <= 0) continue;
      const scale = Math.max(0, (bucketSum - over) / bucketSum);
      const clampedScale = Math.max(0, Math.min(1, scale));
      for (const tile of bucket.tiles) {
        const newCount = Math.floor(tile.drawCount * clampedScale);
        totalInstances -= tile.drawCount - newCount;
        tile.drawCount = Math.max(0, Math.min(tile.ringCap, newCount));
      }
    }
    if (totalInstances > remaining) {
      const nearBucket = ringBuckets[0];
      const bucketSum =
        nearBucket.tiles.reduce((sum, tile) => sum + tile.drawCount, 0) || 1;
      const clampedScale = Math.max(0, Math.min(1, remaining / bucketSum));
      for (const tile of nearBucket.tiles) {
        const newCount = Math.floor(tile.drawCount * clampedScale);
        tile.drawCount = Math.max(0, Math.min(tile.ringCap, newCount));
      }
    }
  }

  if (debug) {
    for (const tile of states) {
      const ringHue =
        tile.ringIndex === 0 ? 110 : tile.ringIndex === 1 ? 80 : 170;
      const truncated = tile.drawCount < tile.ringCap;
      const hue = (truncated ? 25 : ringHue) / 360;
      const tip = tile.debugTip ?? new THREE.Color();
      tip.setHSL(hue, 0.8, 0.55);
      tile.debugTip = tip;
      const bottom = tile.debugBottom ?? new THREE.Color();
      bottom.setHSL(hue, 0.9, 0.25);
      tile.debugBottom = bottom;
    }
  }
}

/**
 * Per-ring LOD configuration. Rings are ordered from near (index 0) to far (last index).
 * A tile's ring is chosen by its Chebyshev distance in tiles from the camera tile.
 */
export type RingConfig = {
  /**
   * inclusive Chebyshev distance from camera tile
   */
  maxDistanceTiles: number;
  joints: number;
  densityPerUnit2: number; // blades per world unit^2
  bladeHeight?: number;
  useInteract?: boolean;
  maxPerTile?: number; // hard cap per tile for this ring
};

/**
 * Props for the GrassField tiler and LOD system.
 */
export interface GrassFieldProps {
  /**
   * Tile width/height in world units. Smaller tiles increase tile count (more frequent updates),
   * larger tiles reduce updates but raise per-tile instance counts.
   * Tip: 64–128 works well; use 64 when iterating on near density.
   */
  tileSize?: number;
  /**
   * LOD rings from near (index 0) to far (last). Each ring sets the maximum Chebyshev distance
   * (in tiles) at which its settings apply, along with per-tile density and blade detail.
   * Note: The farthest ring is rendered as crossed-card tufts (via useCards) to reduce cost.
   */
  rings?: RingConfig[];
  /**
   * Optional wind texture; if omitted a procedural canvas texture is created. Keep small (64–128)
   * and tiling; it is sampled in the vertex shader for blade sway.
   */
  windTexture?: THREE.Texture | null;
  /**
   * Absolute per-tile instance cap (upper bound). Individual rings can further lower this using
   * RingConfig.maxPerTile. Defaults to 60k.
   */
  absMaxPerTile?: number;
  /**
   * Global budget for the sum of instance draw counts across all visible tiles. If the budget is
   * exceeded, far rings are proportionally reduced first, then mid, preserving near density.
   */
  maxGlobalInstances?: number;
  /**
   * Resolution (pixels) of the interaction/flattening texture. Higher values reduce blockiness but
   * increase CPU time and memory. 512 is a good default.
   */
  interactionSize?: number;
  /**
   * Target rate (FPS) at which the interaction texture fades each frame. Lower values reduce CPU
   * cost at the expense of slower recovery of flattened grass (e.g., 30).
   */
  interactionFadeFps?: number;
  /**
   * Number of ground mesh segments per tile edge. Controls ground tessellation used for blade root
   * height sampling and lighting. Typical range 4–12.
   */
  groundSegmentsPerTile?: number;
  /**
   * Show demo rolling spheres that interact with the grass (useful for testing).
   */
  showBalls?: boolean;
  /**
   * Enable debug coloring and overlays to visualize LOD rings and truncation/saturation events.
   * - Near ring tiles: bright green; Mid: yellow-green; Far: cyan/blue-green.
   * - If a tile hits per-tile capacity cap: orange tint.
   * - If global budget scales this tile down: red tint proportional to reduction.
   */
  debug?: boolean;
}

function useInteractionTexture({ size = 1024, decay = 0.98 } = {}) {
  const canvas = useMemo(
    () =>
      Object.assign(document.createElement("canvas"), {
        width: size,
        height: size,
      }),
    [size],
  );
  const ctx = useMemo(
    () => canvas.getContext("2d") as CanvasRenderingContext2D,
    [canvas],
  );
  const texture = useMemo(() => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    return t;
  }, [canvas]);

  const fade = () => {
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = `rgba(0,0,0,${1 - decay})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    texture.needsUpdate = true;
  };

  const makeStamper =
    (boundsMin: THREE.Vector2, boundsSize: THREE.Vector2) =>
    (x: number, z: number, radiusWorld: number, strength = 1) => {
      const u = (x - boundsMin.x) / boundsSize.x;
      const v = (z - boundsMin.y) / boundsSize.y;
      if (u < 0 || u > 1 || v < 0 || v > 1) return;
      const r =
        (radiusWorld / Math.max(boundsSize.x, boundsSize.y)) * canvas.width;
      const gx = u * canvas.width;
      const gy = (1 - v) * canvas.height;
      const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, r);
      grad.addColorStop(0, `rgba(255,255,255,${0.9 * strength})`);
      grad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(gx, gy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      texture.needsUpdate = true;
    };

  return { texture, fade, makeStamper, size };
}

function RollingBall({
  stamper,
  boundsMin,
  boundsSize,
  radius = 2,
  speed = 0.6,
  groundRef,
  phaseX = 0,
  phaseZ = 0,
  freqX = 0.35,
  freqZ = 0.5,
}: {
  stamper: ReturnType<ReturnType<typeof useInteractionTexture>["makeStamper"]>;
  boundsMin: THREE.Vector2;
  boundsSize: THREE.Vector2;
  radius?: number;
  speed?: number;
  groundRef?: React.RefObject<THREE.Mesh | null>;
  phaseX?: number;
  phaseZ?: number;
  freqX?: number;
  freqZ?: number;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const ray = useMemo(() => new THREE.Raycaster(), []);
  useFrame((state) => {
    const t = state.clock.getElapsedTime() * speed;
    const x =
      boundsMin.x + (0.5 + 0.5 * Math.sin(t * freqX + phaseX)) * boundsSize.x;
    const z =
      boundsMin.y + (0.5 + 0.5 * Math.cos(t * freqZ + phaseZ)) * boundsSize.y;
    let y = radius;
    const ground = groundRef?.current;
    if (ground) {
      ray.set(new THREE.Vector3(x, 1000, z), new THREE.Vector3(0, -1, 0));
      const hits = ray.intersectObject(ground, false);
      if (hits.length > 0) y = (hits[0].point.y ?? 0) + radius;
    }
    if (ref.current) ref.current.position.set(x, y, z);
    if (stamper) stamper(x, z, radius, 1.0);
  });
  return (
    <mesh ref={ref} castShadow receiveShadow>
      <sphereGeometry args={[radius, 24, 24]} />
      <meshStandardMaterial color="#cccccc" metalness={0.2} roughness={0.6} />
    </mesh>
  );
}

function makeGroundGeometry(
  width: number,
  segments: number,
  origin: THREE.Vector2,
) {
  return makeGroundGeometryLib(width, segments, origin);
}

const defaultRings: RingConfig[] = [
  {
    maxDistanceTiles: 1,
    joints: 4,
    densityPerUnit2: 10.5,
    bladeHeight: 1.0,
    useInteract: true,
    maxPerTile: 500000,
  },
  {
    maxDistanceTiles: 4,
    joints: 3,
    densityPerUnit2: 0.05,
    bladeHeight: 1.0,
    useInteract: false,
    maxPerTile: 15000,
  },
  {
    maxDistanceTiles: 8,
    joints: 2,
    densityPerUnit2: 0.003,
    bladeHeight: 1.0,
    useInteract: false,
    maxPerTile: 4000,
  },
];

export function GrassField({
  tileSize = 128,
  rings = defaultRings,
  windTexture,
  absMaxPerTile = 60000,
  maxGlobalInstances = 450000,
  interactionSize = 512,
  interactionFadeFps = 30,
  groundSegmentsPerTile = 8,
  showBalls = true,
  debug = false,
}: GrassFieldProps) {
  console.log('GrassField render')
  useEffect(() => {
    console.log("GrassField mount");
    return () => {
      console.log("GrassField unmount");
    };
  }, []);

  const { camera } = useThree();
  const interact = useInteractionTexture({
    size: interactionSize,
    decay: 0.995,
  });
  const groundRef = useRef<THREE.Mesh>(null);
  const tileOriginCacheRef = useRef<Map<string, THREE.Vector2>>(new Map());
  const tileStatesRef = useRef<TileState[]>([]);
  const tileVersionStoreRef = useRef<ValueStore<number>>(createStore(0));
  const tileVersion = useSyncExternalStore(
    tileVersionStoreRef.current.subscribe,
    tileVersionStoreRef.current.get,
    tileVersionStoreRef.current.get,
  );
  void tileVersion; // ensure component resubscribes when tile states mutate

  const initialCenterRef = useRef<CenterCoord>();
  if (!initialCenterRef.current) {
    initialCenterRef.current = {
      x: Math.floor((camera?.position.x ?? 0) / tileSize),
      z: Math.floor((camera?.position.z ?? 0) / tileSize),
    };
  }

  const centerStoreRef = useRef<ValueStore<CenterCoord>>();
  if (!centerStoreRef.current) {
    centerStoreRef.current = createStore(
      initialCenterRef.current,
      (a, b) => a.x === b.x && a.z === b.z,
    );
  }
  const centerStore = centerStoreRef.current;
  const centerTile = useSyncExternalStore(
    centerStore.subscribe,
    centerStore.get,
    centerStore.get,
  );

  useFrame(() => {
    const cx = Math.floor(camera.position.x / tileSize);
    const cz = Math.floor(camera.position.z / tileSize);
    const current = centerStore.get();
    if (current.x !== cx || current.z !== cz) {
      centerStore.set({ x: cx, z: cz });
    }
  });

  useEffect(() => {
    const cx = Math.floor(camera.position.x / tileSize);
    const cz = Math.floor(camera.position.z / tileSize);
    const current = centerStore.get();
    if (current.x !== cx || current.z !== cz) centerStore.set({ x: cx, z: cz });
  }, [camera, tileSize, centerStore]);

  const farRing = rings[rings.length - 1]?.maxDistanceTiles ?? 6;
  const halfTiles = farRing;
  const totalTiles = 2 * halfTiles + 1;
  const worldWidth = totalTiles * tileSize;

  const sanitizedAbsMax = Math.max(1, absMaxPerTile | 0);
  const maxRingCapacity = useMemo(
    () =>
      rings.reduce(
        (acc, cfg) => Math.max(acc, cfg.maxPerTile ?? sanitizedAbsMax),
        sanitizedAbsMax,
      ),
    [rings, sanitizedAbsMax],
  );
  const tileCapacity = Math.max(1, Math.min(sanitizedAbsMax, maxRingCapacity));
  const sanitizedGlobalInstances = Math.max(1, maxGlobalInstances | 0);

  if (tileStatesRef.current.length !== totalTiles * totalTiles) {
    tileStatesRef.current = createInitialTileStates({
      totalTiles,
      center: centerTile,
      tileSize,
      halfTiles,
      originCache: tileOriginCacheRef.current,
    });
  }

  useEffect(() => {
    const expected = totalTiles * totalTiles;
    if (tileStatesRef.current.length !== expected) {
      tileStatesRef.current = createInitialTileStates({
        totalTiles,
        center: centerTile,
        tileSize,
        halfTiles,
        originCache: tileOriginCacheRef.current,
      });
    }
    updateTileStates({
      states: tileStatesRef.current,
      center: centerTile,
      halfTiles,
      tileSize,
      rings,
      maxCapacity: tileCapacity,
      maxGlobalInstances: sanitizedGlobalInstances,
      debug,
      originCache: tileOriginCacheRef.current,
    });
    const store = tileVersionStoreRef.current;
    store.set(store.get() + 1);
  }, [
    centerTile,
    totalTiles,
    halfTiles,
    tileSize,
    rings,
    tileCapacity,
    sanitizedGlobalInstances,
    debug,
  ]);

  const boundsMin = useMemo(
    () =>
      new THREE.Vector2(
        (centerTile.x - halfTiles) * tileSize,
        (centerTile.z - halfTiles) * tileSize,
      ),
    [centerTile.x, centerTile.z, halfTiles, tileSize],
  );
  const boundsSize = useMemo(
    () => new THREE.Vector2(worldWidth, worldWidth),
    [worldWidth],
  );
  const stamper = useMemo(
    () => interact.makeStamper(boundsMin, boundsSize),
    [interact, boundsMin, boundsSize],
  );

  const lastFadeRef = useRef(0);
  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    const interval = 1 / Math.max(1, interactionFadeFps);
    if (t - lastFadeRef.current >= interval) {
      interact.fade();
      lastFadeRef.current = t;
    }
  });

  const segmentsPerTile = Math.max(1, groundSegmentsPerTile | 0);
  const groundSegments = Math.min(
    256,
    Math.max(32, totalTiles * segmentsPerTile),
  );
  const initialCenter = initialCenterRef.current;
  const groundGeo = useMemo(
    () =>
      makeGroundGeometry(
        worldWidth,
        groundSegments,
        new THREE.Vector2(
          initialCenter.x * tileSize + tileSize * 0.5,
          initialCenter.z * tileSize + tileSize * 0.5,
        ),
      ),
    [worldWidth, groundSegments, tileSize, initialCenter.x, initialCenter.z],
  );
  const groundGeometryRef = useRef<THREE.PlaneGeometry>(
    groundGeo as THREE.PlaneGeometry,
  );
  if (groundGeometryRef.current !== groundGeo)
    groundGeometryRef.current = groundGeo as THREE.PlaneGeometry;

  useEffect(() => {
    const geo = groundGeometryRef.current;
    if (!geo) return;
    const origin = new THREE.Vector2(
      centerTile.x * tileSize + tileSize * 0.5,
      centerTile.z * tileSize + tileSize * 0.5,
    );
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const worldX = pos.getX(i) + origin.x;
      const worldZ = pos.getZ(i) + origin.y;
      const y = getTerrainHeight(worldX, worldZ);
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  }, [centerTile.x, centerTile.z, tileSize]);

  const tileStates = tileStatesRef.current;

  return (
    <>
      {/* Ground spanning all rings */}
      <mesh
        ref={groundRef}
        position={[
          centerTile.x * tileSize + tileSize * 0.5,
          0,
          centerTile.z * tileSize + tileSize * 0.5,
        ]}
        geometry={groundGeometryRef.current}
        receiveShadow
      >
        <meshStandardMaterial color="#0a2a0a" />
      </mesh>

      {/* Grass tiles */}
      {tileStates.map((tile) => (
        <Grass
          key={tile.id}
          options={{
            bW: 0.12,
            bH: tile.bladeHeight,
            joints: tile.joints,
            useCards: tile.useCards,
          }}
          width={tileSize}
          capacity={tileCapacity}
          instanceCount={tile.drawCount}
          interactionTexture={interact.texture}
          useInteract={tile.useInteract}
          boundsMin={boundsMin}
          boundsSize={boundsSize}
          flattenStrength={0.9}
          origin={tile.origin}
          seed={tile.seed}
          windTexture={windTexture ?? null}
          windScale={0.02}
          windSpeed={0.2}
          renderGround={false}
          tipColorOverride={debug ? tile.debugTip : undefined}
          bottomColorOverride={debug ? tile.debugBottom : undefined}
          visible={tile.drawCount > 0}
        />
      ))}

      {/* A few rolling balls to demonstrate interaction across tiles */}
      {showBalls ? (
        <RollingBall
          stamper={stamper}
          boundsMin={boundsMin}
          boundsSize={boundsSize}
          radius={4}
          speed={0.35}
          groundRef={groundRef}
          phaseX={0}
          phaseZ={0}
          freqX={0.22}
          freqZ={0.28}
        />
      ) : null}

      {/* Lighting and controls are expected to be provided by the parent scene */}
    </>
  );
}

export default GrassField;
