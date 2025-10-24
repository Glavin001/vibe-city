import type { ScenarioDesc, Vec3 } from "@/lib/stress/core/types";

const EPSILON = 1e-8;

type Vec3i = { x: number; y: number; z: number };

type IncludeArgs = {
  ix: number;
  iy: number;
  iz: number;
  segments: Vec3i;
  position: Vec3;
};

type RectilinearOptions = {
  size: Vec3;
  segments: Vec3i;
  center?: Vec3;
  includeNode?: (args: IncludeArgs) => boolean;
  supportPredicate?: (args: IncludeArgs) => boolean;
  deckMass?: number;
  areaScale?: number;
  addDiagonals?: boolean;
  diagScale?: number;
  normalizeAreas?: boolean;
  bondsX?: boolean;
  bondsY?: boolean;
  bondsZ?: boolean;
};

function clampSegments(value: number): number {
  return Math.max(1, Math.floor(value));
}

function makeVec(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

function subVec(a: Vec3, b: Vec3): Vec3 {
  return makeVec(a.x - b.x, a.y - b.y, a.z - b.z);
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len <= EPSILON) return makeVec(0, 0, 0);
  return makeVec(v.x / len, v.y / len, v.z / len);
}

export function buildRectilinearScenario({
  size,
  segments,
  center,
  includeNode,
  supportPredicate,
  deckMass = 14_000,
  areaScale = 0.05,
  addDiagonals = false,
  diagScale = 0.75,
  normalizeAreas = true,
  bondsX = true,
  bondsY = true,
  bondsZ = true,
}: RectilinearOptions): ScenarioDesc {
  const segX = clampSegments(segments.x);
  const segY = clampSegments(segments.y);
  const segZ = clampSegments(segments.z);

  const cellX = size.x / segX;
  const cellY = size.y / segY;
  const cellZ = size.z / segZ;

  const origin = makeVec(
    (center?.x ?? 0) - size.x * 0.5 + cellX * 0.5,
    (center?.y ?? size.y * 0.5) - size.y * 0.5 + cellY * 0.5,
    (center?.z ?? 0) - size.z * 0.5 + cellZ * 0.5,
  );

  const grid: number[][][] = Array.from({ length: segX }, () =>
    Array.from({ length: segY }, () => Array.from({ length: segZ }, () => -1)),
  );

  const nodes: ScenarioDesc["nodes"] = [];
  const gridCoordinates: Array<{ ix: number; iy: number; iz: number }> = [];

  const include = includeNode ?? (() => true);
  const support = supportPredicate ?? (({ iy }) => iy === 0);

  const cellVolume = cellX * cellY * cellZ;

  let totalVolume = 0;

  for (let ix = 0; ix < segX; ix += 1) {
    for (let iy = 0; iy < segY; iy += 1) {
      for (let iz = 0; iz < segZ; iz += 1) {
        const position = makeVec(origin.x + ix * cellX, origin.y + iy * cellY, origin.z + iz * cellZ);
        if (!include({ ix, iy, iz, segments: { x: segX, y: segY, z: segZ }, position })) continue;
        const isSupport = support({ ix, iy, iz, segments: { x: segX, y: segY, z: segZ }, position });
        const nodeIndex = nodes.length;
        const volume = isSupport ? 0 : cellVolume;
        if (!isSupport) totalVolume += volume;
        nodes.push({ centroid: position, mass: volume, volume });
        grid[ix][iy][iz] = nodeIndex;
        gridCoordinates[nodeIndex] = { ix, iy, iz };
      }
    }
  }

  const massScale = totalVolume > 0 ? deckMass / totalVolume : 0;
  if (massScale > 0) {
    nodes.forEach((node) => {
      if (node.volume > 0) {
        node.mass = node.volume * massScale;
      } else {
        node.mass = 0;
      }
    });
  } else {
    nodes.forEach((node) => {
      node.mass = 0;
    });
  }

  const bonds: ScenarioDesc["bonds"] = [];

  const areaX = cellY * cellZ * areaScale;
  const areaY = cellX * cellZ * areaScale;
  const areaZ = cellX * cellY * areaScale;

  const addBond = (a: number, b: number, area: number) => {
    if (a < 0 || b < 0) return;
    const na = nodes[a];
    const nb = nodes[b];
    const centroid = makeVec(
      (na.centroid.x + nb.centroid.x) * 0.5,
      (na.centroid.y + nb.centroid.y) * 0.5,
      (na.centroid.z + nb.centroid.z) * 0.5,
    );
    const normal = normalize(subVec(nb.centroid, na.centroid));
    bonds.push({ node0: a, node1: b, centroid, normal, area: Math.max(area, EPSILON) });
  };

  for (let ix = 0; ix < segX; ix += 1) {
    for (let iy = 0; iy < segY; iy += 1) {
      for (let iz = 0; iz < segZ; iz += 1) {
        const current = grid[ix][iy][iz];
        if (current < 0) continue;
        if (bondsX && ix + 1 < segX) addBond(current, grid[ix + 1][iy][iz], areaX);
        if (bondsY && iy + 1 < segY) addBond(current, grid[ix][iy + 1][iz], areaY);
        if (bondsZ && iz + 1 < segZ) addBond(current, grid[ix][iy][iz + 1], areaZ);
        if (addDiagonals) {
          if (bondsX && bondsY && ix + 1 < segX && iy + 1 < segY) addBond(current, grid[ix + 1][iy + 1][iz], 0.5 * (areaX + areaY) * diagScale);
          if (bondsX && bondsZ && ix + 1 < segX && iz + 1 < segZ) addBond(current, grid[ix + 1][iy][iz + 1], 0.5 * (areaX + areaZ) * diagScale);
          if (bondsY && bondsZ && iy + 1 < segY && iz + 1 < segZ) addBond(current, grid[ix][iy + 1][iz + 1], 0.5 * (areaY + areaZ) * diagScale);
        }
      }
    }
  }

  if (normalizeAreas && bonds.length) {
    const target = { x: size.y * size.z, y: size.x * size.z, z: size.x * size.y };
    const sum = { x: 0, y: 0, z: 0 };
    const pick = (n: Vec3): "x" | "y" | "z" => {
      const ax = Math.abs(n.x);
      const ay = Math.abs(n.y);
      const az = Math.abs(n.z);
      if (ax >= ay && ax >= az) return "x";
      if (ay >= az) return "y";
      return "z";
    };
    bonds.forEach((bond) => {
      sum[pick(bond.normal)] += bond.area;
    });
    const scale = {
      x: sum.x > 0 ? target.x / sum.x : 1,
      y: sum.y > 0 ? target.y / sum.y : 1,
      z: sum.z > 0 ? target.z / sum.z : 1,
    } as const;
    bonds.forEach((bond) => {
      bond.area *= scale[pick(bond.normal)];
    });
  }

  return {
    nodes,
    bonds,
    gridCoordinates,
    spacing: makeVec(cellX, cellY, cellZ),
    parameters: { size, segments, deckMass, areaScale, addDiagonals },
  } satisfies ScenarioDesc;
}

type PresetOptions = {
  bondsX?: boolean;
  bondsY?: boolean;
  bondsZ?: boolean;
};

export function buildHutScenario({ bondsX = true, bondsY = true, bondsZ = true }: PresetOptions = {}): ScenarioDesc {
  const segments = { x: 18, y: 9, z: 14 };
  const doorStart = Math.floor(segments.x * 0.38);
  const doorEnd = Math.ceil(segments.x * 0.62);
  const doorHeight = Math.floor(segments.y * 0.55);
  const windowRow = Math.floor(segments.y * 0.65);
  const windowStart = Math.floor(segments.z * 0.35);
  const windowEnd = Math.ceil(segments.z * 0.65);

  return buildRectilinearScenario({
    size: makeVec(6.5, 3.4, 5.2),
    segments,
    deckMass: 19_000,
    areaScale: 0.052,
    addDiagonals: true,
    diagScale: 0.6,
    normalizeAreas: true,
    bondsX,
    bondsY,
    bondsZ,
    includeNode: ({ ix, iy, iz, segments: seg }) => {
      const onX = ix === 0 || ix === seg.x - 1;
      const onZ = iz === 0 || iz === seg.z - 1;
      const onTop = iy === seg.y - 1;
      if (!onX && !onZ) return false;
      if (onTop) return false; // open roof
      // doorway carve-out on front wall (iz === 0)
      if (iz === 0 && ix >= doorStart && ix <= doorEnd && iy <= doorHeight) {
        return ix === doorStart || ix === doorEnd || iy === doorHeight;
      }
      // side window on the right wall
      if (ix === seg.x - 1 && iy === windowRow && iz >= windowStart && iz <= windowEnd) {
        return iy === windowRow && (iz === windowStart || iz === windowEnd);
      }
      return true;
    },
  });
}

export function buildBridgeScenario({ bondsX = true, bondsY = true, bondsZ = true }: PresetOptions = {}): ScenarioDesc {
  const segments = { x: 40, y: 12, z: 12 };
  const deckLayers = 2;
  const towerHeight = segments.y - 1;
  const towerWidth = Math.floor(segments.x * 0.08);
  const towerOffset = Math.floor(segments.x * 0.18);
  const cablePeak = segments.y - 1;
  const cableSpanStart = towerOffset + towerWidth;
  const cableSpanEnd = segments.x - cableSpanStart - 1;
  const cableSpanLength = Math.max(1, cableSpanEnd - cableSpanStart);

  return buildRectilinearScenario({
    size: makeVec(18, 4.6, 4.8),
    segments,
    deckMass: 24_000,
    areaScale: 0.06,
    addDiagonals: true,
    diagScale: 0.55,
    normalizeAreas: true,
    bondsX,
    bondsY,
    bondsZ,
    includeNode: ({ ix, iy, iz, segments: seg }) => {
      const isDeck = iy <= deckLayers;
      const isTower = (ix <= towerOffset || ix >= seg.x - towerOffset - 1) && iy <= towerHeight && (iz <= 2 || iz >= seg.z - 3);
      let isCable = false;
      if (ix >= cableSpanStart && ix <= cableSpanEnd && (iz === 0 || iz === seg.z - 1)) {
        const normalized = (ix - cableSpanStart) / cableSpanLength;
        const desiredHeight = deckLayers + Math.round(Math.sin(normalized * Math.PI) * (cablePeak - deckLayers));
        if (iy >= desiredHeight && iy <= cablePeak) {
          isCable = (iy - desiredHeight) % 2 === 0;
        }
      }
      return isDeck || isTower || isCable;
    },
    supportPredicate: ({ ix, iy, segments: seg }) => {
      if (iy > 0) return false;
      return ix <= towerOffset || ix >= seg.x - towerOffset - 1;
    },
  });
}

export function buildTowerScenario({ bondsX = true, bondsY = true, bondsZ = true }: PresetOptions = {}): ScenarioDesc {
  const segments = { x: 16, y: 22, z: 16 };
  const floorHeights = [0, Math.floor(segments.y * 0.33), Math.floor(segments.y * 0.66), segments.y - 2];
  const columnPositions = [Math.floor(segments.x * 0.25), Math.floor(segments.x * 0.75)];

  return buildRectilinearScenario({
    size: makeVec(6.8, 9.2, 6.8),
    segments,
    deckMass: 280_000,
    areaScale: 0.055,
    addDiagonals: true,
    diagScale: 0.65,
    normalizeAreas: true,
    bondsX,
    bondsY,
    bondsZ,
    includeNode: ({ ix, iy, iz, segments: seg }) => {
      const onShell = ix === 0 || ix === seg.x - 1 || iz === 0 || iz === seg.z - 1;
      const isRoof = iy === seg.y - 1;
      const isFloor = floorHeights.includes(iy);
      const inColumn = columnPositions.includes(ix) && columnPositions.includes(iz);
      const hasWindowBand = iy === Math.floor(seg.y * 0.5) && (ix + iz) % 2 === 0;
      if (isRoof) return true;
      if (onShell) {
        if (iy > Math.floor(seg.y * 0.4) && (ix === Math.floor(seg.x * 0.5) || iz === Math.floor(seg.z * 0.5))) {
          return (iy - Math.floor(seg.y * 0.4)) % 2 === 0; // vertical slit windows
        }
        return true;
      }
      if (isFloor) return true;
      if (inColumn) return true;
      if (hasWindowBand) return true;
      return false;
    },
  });
}

export type StressPresetId = "wall" | "hut" | "bridge" | "beamBridge" | "tower" | "fracturedWall";

export const STRESS_PRESET_METADATA: Array<{
  id: StressPresetId;
  label: string;
  description: string;
}> = [
  {
    id: "wall",
    label: "Tunable wall panel",
    description: "Baseline single wall for dialing in solver parameters and stress thresholds.",
  },
  {
    id: "hut",
    label: "Mini concrete hut",
    description: "Hollow four-wall shelter with a doorway and side window to showcase shell fragmentation.",
  },
  {
    id: "bridge",
    label: "Suspension footbridge",
    description: "Slender deck with towers and cable arcs to demonstrate tension and support failures.",
  },
  {
    id: "beamBridge",
    label: "Beam bridge",
    description: "Deck on end posts with massless footings; rectilinear blocks bonded as a slab.",
  },
  {
    id: "tower",
    label: "Multi-storey frame tower",
    description: "Tall frame with interior columns and floor plates for progressive collapse testing.",
  },
  {
    id: "fracturedWall",
    label: "Fractured wall",
    description: "Wall built from irregular fracture pieces (three-pinata) instead of a uniform grid.",
  },
];

export function getPresetMetadata(id: StressPresetId) {
  return STRESS_PRESET_METADATA.find((preset) => preset.id === id);
}
