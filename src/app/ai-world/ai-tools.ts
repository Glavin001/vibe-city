import { tool } from 'ai'
import { z } from 'zod'
import type { World, EntityId } from './actions'

export function createAITools(
  worldRef: React.MutableRefObject<World | null>,
  addLog: (message: string) => void,
  triggerWorldUpdate: () => void
) {
  return {
    // ---- Granular tools (preferred) ----
    move_to: tool({
      description: "Move an NPC to a destination. Destinations: 'courtyard' | 'kitchen' | 'workshop' | 'player'",
      inputSchema: z.object({
        npc: z.string().describe("NPC name, e.g. 'Alice' or 'Bob'"),
        destination: z.enum(['courtyard','kitchen','workshop','player']).describe("Where to move")
      }),
      execute: async ({ npc, destination }) => {
        const world = worldRef.current
        if (!world) return { success: false, message: 'World not initialized' }
        let npcId: EntityId | null = null
        for (const [id, agent] of world.agents.entries()) if (agent.name.toLowerCase() === npc.toLowerCase()) { npcId = id; break }
        if (!npcId) return { success: false, message: `NPC ${npc} not found` }
        const approxForRoom = (room: string): { x: number; y: number; z?: number; room: string } | null => {
          if (room === 'courtyard') return { x: 0, y: 1, z: 0, room }
          if (room === 'kitchen') return { x: -5, y: 1, z: -5, room }
          if (room === 'workshop') return { x: 5, y: 1, z: 5, room }
          return null
        }
        const moveToward = async (actor: EntityId, to: { x: number; y: number; z?: number; room?: string }) => {
          const from = world.positions.get(actor)
          if (!from) return false
          const steps = 16
          for (let i = 1; i <= steps; i++) {
            const t = i / steps
            world.positions.set(actor, { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, z: (from.z ?? 0) + ((to.z ?? 0) - (from.z ?? 0)) * t, room: to.room ?? from.room })
            await new Promise(r => setTimeout(r, 60))
          }
          return true
        }
        let target: { x: number; y: number; z?: number; room: string } | null = null
        if (destination === 'player') {
          let playerId: EntityId | null = null
          for (const [id, agent] of world.agents.entries()) if (agent.name.toLowerCase() === 'player') { playerId = id; break }
          const p = playerId ? world.positions.get(playerId) : null
          if (p) target = { x: p.x, y: p.y, z: p.z ?? 0, room: p.room ?? 'courtyard' }
        } else {
          target = approxForRoom(destination)
        }
        if (!target) return { success: false, message: `${npc}: destination not found` }
        await moveToward(npcId, target)
        addLog(`${npc} moved to ${destination}`)
        return { success: true, message: `${npc} moved to ${destination}` }
      }
    }),

    pick_up_object: tool({
      description: "NPC picks up an item by name (fuzzy match) and removes it from the world",
      inputSchema: z.object({
        npc: z.string().describe("NPC name"),
        item: z.string().describe("Item name, e.g. 'blue mug' or 'key'")
      }),
      execute: async ({ npc, item }) => {
        const world = worldRef.current
        if (!world) return { success: false, message: 'World not initialized' }
        let npcId: EntityId | null = null
        for (const [id, agent] of world.agents.entries()) if (agent.name.toLowerCase() === npc.toLowerCase()) { npcId = id; break }
        if (!npcId) return { success: false, message: `NPC ${npc} not found` }
        let itemId: EntityId | null = null
        const q = item.toLowerCase()
        for (const [id, it] of world.items.entries()) if (it.name.toLowerCase().includes(q)) { itemId = id; break }
        if (!itemId) return { success: false, message: `${npc}: item '${item}' not found` }
        const ip = world.positions.get(itemId)
        if (ip) {
          // move to item
          const from = world.positions.get(npcId)
          if (from) {
            const steps = 12
            for (let i = 1; i <= steps; i++) {
              const t = i / steps
              world.positions.set(npcId, { x: from.x + (ip.x - from.x) * t, y: from.y + (ip.y - from.y) * t, z: (from.z ?? 0) + ((ip.z ?? 0) - (from.z ?? 0)) * t, room: ip.room ?? from.room })
              await new Promise(r => setTimeout(r, 60))
            }
          }
        }
        const inv = world.inventories.get(npcId)
        if (!inv) return { success: false, message: `${npc}: no inventory` }
        if (!inv.items.includes(itemId)) inv.items.push(itemId)
        world.positions.delete(itemId)
        triggerWorldUpdate() // Force 3D scene update
        addLog(`${npc} picked up ${world.items.get(itemId)?.name}`)
        return { success: true, message: `${npc} picked up ${world.items.get(itemId)?.name}` }
      }
    }),

    give_object: tool({
      description: "NPC gives an item they carry to a receiver (Player or another NPC)",
      inputSchema: z.object({
        npc: z.string().describe("NPC name"),
        item: z.string().optional().describe("Item name if specified; otherwise first item"),
        to: z.string().describe("Receiver: 'Player' | 'Alice' | 'Bob'")
      }),
      execute: async ({ npc, item, to }) => {
        const world = worldRef.current
        if (!world) return { success: false, message: 'World not initialized' }
        const resolveAgentId = (name: string): EntityId | null => {
          for (const [id, agent] of world.agents.entries()) if (agent.name.toLowerCase() === name.toLowerCase()) return id
          return null
        }
        const npcId = resolveAgentId(npc)
        const recvId = resolveAgentId(to)
        if (!npcId || !recvId) return { success: false, message: 'Agent not found' }
        const inv = world.inventories.get(npcId)
        if (!inv || inv.items.length === 0) return { success: false, message: `${npc}: no items to give` }
        let itemId = inv.items[0]
        if (item) {
          const q = item.toLowerCase()
          const found = inv.items.find(id => world.items.get(id)?.name.toLowerCase().includes(q))
          if (found) itemId = found
        }
        // move to receiver
        const rp = world.positions.get(recvId)
        if (rp) {
          const from = world.positions.get(npcId)
          if (from) {
            const steps = 12
            for (let i = 1; i <= steps; i++) {
              const t = i / steps
              world.positions.set(npcId, { x: from.x + (rp.x - from.x) * t, y: from.y + (rp.y - from.y) * t, z: (from.z ?? 0) + ((rp.z ?? 0) - (from.z ?? 0)) * t, room: rp.room ?? from.room })
              await new Promise(r => setTimeout(r, 60))
            }
          }
        }
        inv.items = inv.items.filter(i => i !== itemId)
        const rinv = world.inventories.get(recvId)
        if (rinv && !rinv.items.includes(itemId)) rinv.items.push(itemId)
        triggerWorldUpdate() // Force UI update
        addLog(`${npc} gave ${world.items.get(itemId)?.name ?? 'item'} to ${to}`)
        return { success: true, message: `${npc} gave ${world.items.get(itemId)?.name ?? 'item'} to ${to}` }
      }
    }),
    inspect_world: tool({
      description: "Get detailed information about the current world state, including all agents, items, machines, and their locations",
      inputSchema: z.object({}),
      execute: async () => {
        const world = worldRef.current
        if (!world) return { success: false, message: "World not initialized" }
        
        const agents = Array.from(world.agents.entries()).map(([id, agent]) => ({
          id,
          name: agent.name,
          position: world.positions.get(id),
          inventory: world.inventories.get(id)?.items.length || 0
        }))
        const items = Array.from(world.items.entries()).map(([id, item]) => ({
          id,
          name: item.name,
          position: world.positions.get(id),
          tags: item.tags
        }))
        const machines = Array.from(world.machines.entries()).map(([id, machine]) => ({
          id,
          name: machine.name,
          position: world.positions.get(id),
          powered: machine.powered
        }))
        
        return {
          success: true,
          agents,
          items,
          machines,
          message: `World contains ${agents.length} agents, ${items.length} items, and ${machines.length} machines`
        }
      }
    }),
    
    
    check_inventory: tool({
      description: "Check the inventory of an agent (player or NPC)",
      inputSchema: z.object({
        agent_name: z.string().describe("Name of agent to check ('Player', 'Alice', 'Bob', etc.)")
      }),
      execute: async ({ agent_name }) => {
        const world = worldRef.current
        if (!world) return { success: false, message: "World not initialized" }
        
        let agentId: EntityId | null = null
        for (const [id, agent] of world.agents.entries()) {
          if (agent.name.toLowerCase() === agent_name.toLowerCase()) {
            agentId = id
            break
          }
        }
        
        if (!agentId) {
          return { success: false, message: `Agent ${agent_name} not found` }
        }
        
        const inv = world.inventories.get(agentId)
        if (!inv) {
          return { success: false, message: `${agent_name} has no inventory` }
        }
        
        const items = inv.items.map(itemId => {
          const item = world.items.get(itemId)
          return item ? item.name : itemId
        })
        
        return {
          success: true,
          agent: agent_name,
          items,
          slots_used: inv.items.length,
          slots_total: inv.capacitySlots,
          hands_used: inv.handsOccupied,
          hands_total: inv.hands,
          message: items.length > 0 
            ? `${agent_name} is carrying: ${items.join(', ')}` 
            : `${agent_name}'s inventory is empty`
        }
      }
    }),

    get_agent_info: tool({
      description: "Get detailed information about a specific agent including their stats, skills, and current state",
      inputSchema: z.object({
        agent_name: z.string().describe("Name of agent to inspect")
      }),
      execute: async ({ agent_name }) => {
        const world = worldRef.current
        if (!world) return { success: false, message: "World not initialized" }
        
        let agentId: EntityId | null = null
        for (const [id, agent] of world.agents.entries()) {
          if (agent.name.toLowerCase() === agent_name.toLowerCase()) {
            agentId = id
            break
          }
        }
        
        if (!agentId) {
          return { success: false, message: `Agent ${agent_name} not found` }
        }
        
        const agent = world.agents.get(agentId)
        const position = world.positions.get(agentId)
        const inventory = world.inventories.get(agentId)
        
        if (!agent) {
          return { success: false, message: `Agent data not found` }
        }
        
        return {
          success: true,
          name: agent.name,
          faction: agent.faction,
          traits: agent.traits,
          skills: agent.skills,
          motives: agent.motives,
          position,
          inventory_count: inventory?.items.length || 0,
          message: `${agent.name} is a ${agent.faction} with traits: ${agent.traits.join(', ')}`
        }
      }
    })
  }
}

export const AI_SYSTEM_PROMPT = `You are an AI assistant in an interactive 3D world. You can see and interact with agents, items, and machines in the environment.

The world contains:
- Multiple NPCs (Alice, Bob) who can be commanded to perform actions
- Items that can be picked up and used (mugs, keys, etc.)
- Machines that can be operated (coffee machines, etc.)
- A physics-based 3D environment with buildings and locations

You have access to tools to:
- Inspect the world state (see all agents, items, machines)
- Command NPCs to perform actions
- Check inventories of any agent
- Get detailed information about agents

Be helpful, observant, and use your tools to provide accurate information and execute commands. When describing locations or giving directions, be specific and clear.`

