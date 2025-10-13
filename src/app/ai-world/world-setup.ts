import { World, type EntityId, newId } from './actions'

export function createDemoWorld(): { 
  world: World
  playerAgent: EntityId
  npcAgents: EntityId[]
  items: EntityId[]
  machines: EntityId[] 
} {
  const world = new World()
  
  // Create player agent
  const player = newId("player")
  world.agents.set(player, {
    name: "Player",
    speed: 2.0,
    faction: "player",
    motives: { hunger: 0.5, energy: 0.7, social: 0.6 },
    traits: ["curious", "friendly"],
    skills: {},
    relations: {},
    blackboard: {}
  })
  world.inventories.set(player, {
    items: [],
    capacitySlots: 20,
    capacityWeight: 50,
    hands: 2,
    handsOccupied: 0
  })
  world.positions.set(player, { x: 0, y: 1, z: 0, room: "courtyard" })
  
  // Create NPC agents
  const npc1 = newId("npc")
  world.agents.set(npc1, {
    name: "Alice",
    speed: 1.6,
    faction: "friendly",
    motives: { hunger: 0.3, energy: 0.8, social: 0.7 },
    traits: ["helpful", "organized"],
    skills: { barista: 0.9 },
    relations: {},
    blackboard: {}
  })
  world.inventories.set(npc1, {
    items: [],
    capacitySlots: 12,
    capacityWeight: 30,
    hands: 2,
    handsOccupied: 0
  })
  world.positions.set(npc1, { x: -5, y: 1, z: -5, room: "kitchen" })
  
  const npc2 = newId("npc")
  world.agents.set(npc2, {
    name: "Bob",
    speed: 1.8,
    faction: "friendly",
    motives: { hunger: 0.6, energy: 0.5, social: 0.4 },
    traits: ["quiet", "observant"],
    skills: { repair: 0.7 },
    relations: {},
    blackboard: {}
  })
  world.inventories.set(npc2, {
    items: [],
    capacitySlots: 12,
    capacityWeight: 30,
    hands: 2,
    handsOccupied: 0
  })
  world.positions.set(npc2, { x: 5, y: 1, z: 5, room: "workshop" })
  
  // Create items
  const mug1 = newId("item")
  world.items.set(mug1, {
    name: "Red Mug",
    weight: 0.3,
    volume: 0.5,
    tags: ["Carryable", "Mug", "LiquidContainer"],
    temperature: 22,
    liquidType: null,
    durability: 1
  })
  world.positions.set(mug1, { x: -4, y: 1, z: -4, room: "kitchen" })
  
  const mug2 = newId("item")
  world.items.set(mug2, {
    name: "Blue Mug",
    weight: 0.3,
    volume: 0.5,
    tags: ["Carryable", "Mug", "LiquidContainer"],
    temperature: 22,
    liquidType: null,
    durability: 1
  })
  world.positions.set(mug2, { x: -6, y: 1, z: -4, room: "kitchen" })
  
  const key1 = newId("item")
  world.items.set(key1, {
    name: "Golden Key",
    weight: 0.1,
    volume: 0.1,
    tags: ["Carryable", "Key"],
    durability: 1
  })
  world.positions.set(key1, { x: 3, y: 1, z: 3, room: "workshop" })
  
  // Create machines
  const coffeeMachine = newId("machine")
  world.machines.set(coffeeMachine, {
    name: "Coffee Machine",
    tags: ["Machine", "CoffeeMachine", "Powered"],
    powered: true,
    operations: ["brew"],
    inUseBy: null
  })
  world.positions.set(coffeeMachine, { x: -5, y: 1, z: -7, room: "kitchen" })
  
  return {
    world,
    playerAgent: player,
    npcAgents: [npc1, npc2],
    items: [mug1, mug2, key1],
    machines: [coffeeMachine]
  }
}

