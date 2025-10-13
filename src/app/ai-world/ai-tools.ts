import { tool } from 'ai'
import { z } from 'zod'
import type { World, EntityId } from './actions'

export function createAITools(
  worldRef: React.MutableRefObject<World | null>,
  addLog: (message: string) => void
) {
  return {
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
    
    command_npc: tool({
      description: "Command an NPC to perform actions. Available actions: pick_up, give, go_to, use_machine_brew",
      inputSchema: z.object({
        npc_name: z.string().describe("Name of the NPC (e.g., 'Alice', 'Bob')"),
        action: z.string().describe("Action to perform (e.g., 'pick up the red mug', 'go to kitchen')"),
      }),
      execute: async ({ npc_name, action }) => {
        const world = worldRef.current
        if (!world) return { success: false, message: "World not initialized" }
        
        // Find NPC
        let npcId: EntityId | null = null
        for (const [id, agent] of world.agents.entries()) {
          if (agent.name.toLowerCase() === npc_name.toLowerCase()) {
            npcId = id
            break
          }
        }
        
        if (!npcId) {
          return { success: false, message: `NPC ${npc_name} not found` }
        }
        
        addLog(`${npc_name} received command: ${action}`)
        
        // Simple action parsing (this could be much more sophisticated)
        // In a real implementation, you would parse the action and queue it for the NPC
        
        // For demo, just log and return success
        return {
          success: true,
          message: `${npc_name} acknowledged: "${action}"`
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

