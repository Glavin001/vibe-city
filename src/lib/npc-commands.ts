import type { NodeId } from './bunker-world'
import { N } from './bunker-world'

// --- INVENTORY TYPES ---
export type Inventory = {
  hasKey: boolean
  hasC4: boolean
  hasStar: boolean
}

// --- NPC ACTION SYSTEM ---
export type MoveAction = { type: 'move'; to: NodeId }
export type JumpAction = { type: 'jump'; height?: number; durationMs?: number }
export type WaveAction = { type: 'wave'; durationMs?: number }
export type PickupKeyAction = { type: 'pickup_key' }
export type UnlockStorageAction = { type: 'unlock_storage' }
export type PickupC4Action = { type: 'pickup_c4' }
export type PlaceC4Action = { type: 'place_c4' }
export type DetonateAction = { type: 'detonate' }
export type PickupStarAction = { type: 'pickup_star' }

export type NpcAction =
  | MoveAction
  | JumpAction
  | WaveAction
  | PickupKeyAction
  | UnlockStorageAction
  | PickupC4Action
  | PlaceC4Action
  | DetonateAction
  | PickupStarAction

export const NODE_TITLES: Record<NodeId, string> = {
  [N.COURTYARD]: 'Courtyard',
  [N.TABLE]: 'Table',
  [N.STORAGE_DOOR]: 'Storage Door',
  [N.STORAGE_INT]: 'Storage Interior',
  [N.C4_TABLE]: 'C4 Table',
  [N.BUNKER_DOOR]: 'Bunker Door',
  [N.BUNKER_INT]: 'Bunker Interior',
  [N.STAR]: 'Star',
  [N.SAFE]: 'Blast Safe Zone',
}

const LOCATION_ALIASES: Record<string, NodeId> = {
  'courtyard': N.COURTYARD,
  'table': N.TABLE,
  'storage door': N.STORAGE_DOOR,
  'storage interior': N.STORAGE_INT,
  'storage': N.STORAGE_INT,
  'c4 table': N.C4_TABLE,
  'bunker door': N.BUNKER_DOOR,
  'bunker interior': N.BUNKER_INT,
  'bunker': N.BUNKER_INT,
  'star': N.STAR,
  'blast safe zone': N.SAFE,
  'safe': N.SAFE,
}

export function aliasToNodeId(name: string): NodeId | null {
  const node = LOCATION_ALIASES[name.trim().toLowerCase()]
  return node ?? null
}

// Command definitions - single source of truth for all commands
export type CommandCategory = 'movement' | 'action' | 'control' | 'planner'

export type CommandDef = {
  id: string
  category: CommandCategory
  patterns: RegExp[]
  buttonLabel: string
  description: string
  examples: string[]
  parseAction: (match: RegExpMatchArray | null, input: string) => NpcAction | null
  quickAction?: () => NpcAction[] // For quick buttons
}

export const COMMAND_DEFINITIONS: CommandDef[] = [
  // Control commands
  {
    id: 'stop',
    category: 'control',
    patterns: [/^(stop|abort|cancel)$/i],
    buttonLabel: '⏹️ Stop',
    description: 'Stop all current actions',
    examples: ['stop', 'abort', 'cancel'],
    parseAction: () => null, // Special handling in parser
  },
  // Movement commands
  {
    id: 'move',
    category: 'movement',
    patterns: [/^((move|go)\s+to)\s+(.+)$/i],
    buttonLabel: '📍 Move to...',
    description: 'Move to a specific location',
    examples: ['move to table', 'go to bunker door', 'move to storage'],
    parseAction: (match) => {
      if (!match) return null
      const locStr = match[3].trim()
      const node = aliasToNodeId(locStr)
      if (!node) return null
      return { type: 'move', to: node }
    },
  },
  {
    id: 'jump',
    category: 'movement',
    patterns: [/^jump(\s+once)?$/i],
    buttonLabel: '🟰 Jump',
    description: 'Jump in place',
    examples: ['jump', 'jump once'],
    parseAction: () => ({ type: 'jump', height: 0.8, durationMs: 600 }),
    quickAction: () => [{ type: 'jump', height: 0.8, durationMs: 600 }],
  },
  {
    id: 'wave',
    category: 'movement',
    patterns: [/^wave(\s+for\s+(\d+)(s|\s*seconds)?)?$/i],
    buttonLabel: '👋 Wave',
    description: 'Wave for a duration (default 1.5s)',
    examples: ['wave', 'wave for 3s', 'wave for 5 seconds'],
    parseAction: (match) => {
      const dur = match?.[2] ? Number(match[2]) * 1000 : 1500
      return { type: 'wave', durationMs: dur }
    },
    quickAction: () => [{ type: 'wave', durationMs: 1500 }],
  },
  // Action commands
  {
    id: 'pickup_key',
    category: 'action',
    patterns: [/^pick\s*up\s*key$/i],
    buttonLabel: '🗝️ Pick up Key',
    description: 'Pick up the key from the table',
    examples: ['pick up key', 'pickup key'],
    parseAction: () => ({ type: 'pickup_key' }),
    quickAction: () => [{ type: 'move', to: N.TABLE }, { type: 'pickup_key' }],
  },
  {
    id: 'unlock_storage',
    category: 'action',
    patterns: [/^unlock(\s*storage)?$/i],
    buttonLabel: '🔓 Unlock Storage',
    description: 'Unlock the storage door (requires key)',
    examples: ['unlock', 'unlock storage'],
    parseAction: () => ({ type: 'unlock_storage' }),
    quickAction: () => [{ type: 'move', to: N.STORAGE_DOOR }, { type: 'unlock_storage' }],
  },
  {
    id: 'pickup_c4',
    category: 'action',
    patterns: [/^pick\s*up\s*c4$/i],
    buttonLabel: '📦 Pick up C4',
    description: 'Pick up C4 explosives from storage',
    examples: ['pick up c4', 'pickup c4'],
    parseAction: () => ({ type: 'pickup_c4' }),
    quickAction: () => [{ type: 'move', to: N.C4_TABLE }, { type: 'pickup_c4' }],
  },
  {
    id: 'place_c4',
    category: 'action',
    patterns: [/^place\s*c4$/i],
    buttonLabel: '📍 Place C4',
    description: 'Place C4 at the bunker door',
    examples: ['place c4'],
    parseAction: () => ({ type: 'place_c4' }),
    quickAction: () => [{ type: 'move', to: N.BUNKER_DOOR }, { type: 'place_c4' }],
  },
  {
    id: 'detonate',
    category: 'action',
    patterns: [/^detonate$/i],
    buttonLabel: '💥 Detonate',
    description: 'Detonate the placed C4',
    examples: ['detonate'],
    parseAction: () => ({ type: 'detonate' }),
    quickAction: () => [{ type: 'move', to: N.SAFE }, { type: 'detonate' }],
  },
  {
    id: 'pickup_star',
    category: 'action',
    patterns: [/^pick\s*up\s*star$/i],
    buttonLabel: '⭐ Pick up Star',
    description: 'Pick up the star from the bunker',
    examples: ['pick up star', 'pickup star'],
    parseAction: () => ({ type: 'pickup_star' }),
    quickAction: () => [{ type: 'move', to: N.STAR }, { type: 'pickup_star' }],
  },
]

// Helper to get available locations for help text
export function getLocationsList(): string {
  return Object.keys(LOCATION_ALIASES).join(', ')
}

export function parseCommandToActions(input: string): { actions?: NpcAction[]; error?: string; isAbort?: boolean } {
  const segments = input
    .toLowerCase()
    .split(/(?:,|;|\band then\b|\bthen\b|\band\b)/g)
    .map(s => s.trim())
    .filter(Boolean)

  const actions: NpcAction[] = []
  
  for (const seg of segments) {
    let matched = false
    
    // Check each command definition
    for (const cmdDef of COMMAND_DEFINITIONS) {
      for (const pattern of cmdDef.patterns) {
        const match = seg.match(pattern)
        if (match) {
          // Special handling for stop/abort
          if (cmdDef.id === 'stop') {
            return { isAbort: true }
          }
          
          const action = cmdDef.parseAction(match, seg)
          if (action) {
            actions.push(action)
            matched = true
            break
          } else if (cmdDef.id === 'move') {
            // If move command failed, it's likely an unknown location
            const locStr = match[3].trim()
            return { error: `Unknown location: ${locStr}. Available locations: ${getLocationsList()}` }
          }
        }
      }
      if (matched) break
    }
    
    if (!matched) {
      return { error: `Unknown command: "${seg}". Type 'help' to see available commands.` }
    }
  }
  
  if (!actions.length) return { error: 'No commands found' }
  return { actions }
}

