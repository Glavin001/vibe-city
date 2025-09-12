// World geometry, nodes, and pathfinding helpers shared by bunker pages

export type Vec3 = [number, number, number]

export const N = Object.freeze({
  COURTYARD: 'courtyard',
  TABLE: 'table_area',
  STORAGE_DOOR: 'storage_door',
  STORAGE_INT: 'storage_interior',
  C4_TABLE: 'c4_table',
  BUNKER_DOOR: 'bunker_door',
  BUNKER_INT: 'bunker_interior',
  STAR: 'star_pos',
  SAFE: 'safe_spot',
} as const)

export type NodeId = (typeof N)[keyof typeof N]

export type BuildingConfig = {
  center: Vec3
  size: [number, number, number] // [width, height, depth]
  doorFace: 'north' | 'south' | 'east' | 'west'
  doorOffset?: number // distance from building edge for door positioning
  doorSize: [number, number] // [width, height] of the door
}

export const BUILDINGS: Record<string, BuildingConfig> = {
  STORAGE: {
    center: [-10, 0, 8],
    size: [6, 3.5, 4.5],
    doorFace: 'east',
    doorOffset: 1.5,
    doorSize: [1.2, 1.6],
  },
  BUNKER: {
    center: [15, 0, 0],
    size: [7, 5, 7],
    doorFace: 'west',
    doorOffset: 1.5,
    doorSize: [1.8, 2.4],
  },
}

export function getBuildingInteriorPosition(building: BuildingConfig, offsetFromCenter: Vec3 = [0, 0, 0]): Vec3 {
  const [centerX, centerY, centerZ] = building.center
  const [offsetX, offsetY, offsetZ] = offsetFromCenter
  return [centerX + offsetX, centerY + offsetY, centerZ + offsetZ]
}

export function getBuildingDoorPosition(building: BuildingConfig): Vec3 {
  const [centerX, centerY, centerZ] = building.center
  const [width, _height, depth] = building.size
  const offset = building.doorOffset || 0
  switch (building.doorFace) {
    case 'east':
      return [centerX + width / 2 + offset, centerY, centerZ]
    case 'west':
      return [centerX - width / 2 - offset, centerY, centerZ]
    case 'south':
      return [centerX, centerY, centerZ + depth / 2 + offset]
    case 'north':
    default:
      return [centerX, centerY, centerZ - depth / 2 - offset]
  }
}

export const NODE_POS: Record<NodeId, Vec3> = {
  [N.COURTYARD]: [0, 0, 0],
  [N.TABLE]: [-10, 0, 0],
  [N.SAFE]: (() => {
    const pos = getBuildingDoorPosition(BUILDINGS.BUNKER)
    return [pos[0] - 5, pos[1], pos[2]]
  })(),
  [N.STORAGE_DOOR]: getBuildingDoorPosition(BUILDINGS.STORAGE),
  [N.STORAGE_INT]: getBuildingInteriorPosition(BUILDINGS.STORAGE),
  [N.C4_TABLE]: getBuildingInteriorPosition(BUILDINGS.STORAGE, [-1, 0, 0]),
  [N.BUNKER_DOOR]: getBuildingDoorPosition(BUILDINGS.BUNKER),
  [N.BUNKER_INT]: getBuildingInteriorPosition(BUILDINGS.BUNKER),
  [N.STAR]: getBuildingInteriorPosition(BUILDINGS.BUNKER, [2, 0, 0]),
}

// Minimal gate state shape used by adjacency conditions
export type GateState = {
  storageUnlocked: boolean
  bunkerBreached: boolean
}

type Edge<S> = [NodeId, NodeId, (s: S) => boolean]

// Adjacency edges. Keep in sync with C# RawEdges in PlannerBridge.
export const RAW_EDGES: Edge<GateState>[] = [
  [N.COURTYARD, N.TABLE, () => true],
  [N.COURTYARD, N.STORAGE_DOOR, () => true],
  [N.COURTYARD, N.BUNKER_DOOR, () => true],
  [N.COURTYARD, N.SAFE, () => true],
  [N.TABLE, N.STORAGE_DOOR, () => true],
  [N.STORAGE_DOOR, N.STORAGE_INT, (s) => s.storageUnlocked === true],
  [N.STORAGE_INT, N.C4_TABLE, () => true],
  [N.STORAGE_DOOR, N.BUNKER_DOOR, () => true],
  [N.BUNKER_DOOR, N.BUNKER_INT, (s) => s.bunkerBreached === true],
  [N.BUNKER_DOOR, N.SAFE, () => true],
  [N.BUNKER_INT, N.STAR, () => true],
]

export function makeAdjacency<S>(raw: Edge<S>[]) {
  const map: Record<string, Array<{ to: NodeId; when: (s: S) => boolean }>> = {};
  for (const [a, b, when] of raw) {
    if (!map[a]) {
      map[a] = [];
    }
    map[a].push({ to: b, when });

    if (!map[b]) {
      map[b] = [];
    }
    map[b].push({ to: a, when });
  }
  return map;
}

const ADJ = makeAdjacency(RAW_EDGES)

export function neighbors<S extends GateState>(state: S, from: NodeId): NodeId[] {
  return (ADJ[from] || [])
    .filter((e) => e.when(state))
    .map((e) => e.to)
}

export function isImmediatellyReachable<S extends GateState>(state: S, from: NodeId, to: NodeId): boolean {
  return neighbors(state, from).includes(to)
}

export function findPath<S extends GateState>(state: S, from: NodeId, to: NodeId): NodeId[] | null {
  if (from === to) return [from]
  const seen = new Set<NodeId>([from])
  const q: NodeId[] = [from]
  const prev = new Map<NodeId, NodeId>()
  while (q.length) {
    // biome-ignore lint/style/noNonNullAssertion: <explanation>
    const cur = q.shift()!
    for (const n of neighbors(state, cur)) {
      if (seen.has(n)) continue
      seen.add(n)
      prev.set(n, cur)
      if (n === to) {
        const path = [to]
        let p = prev.get(to)
        while (p !== undefined) {
          path.push(p)
          p = prev.get(p)
        }
        path.reverse()
        return path
      }
      q.push(n)
    }
  }
  return null
}


