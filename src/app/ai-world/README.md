# AI World - Advanced Interactive 3D Environment

A comprehensive interactive 3D world with physics simulation, AI-powered NPCs, and advanced action systems.

## Features

- **3D Physics-Based World**: Built with Three.js and Rapier physics engine
- **AI-Powered NPCs**: Multiple autonomous agents with personalities, skills, and inventories
- **Advanced Action System**: HTN (Hierarchical Task Network) planning with GOAP-style actions
- **Gemini AI Integration**: Natural language chat interface with tool calling
- **ECS-Style Architecture**: Entity-Component-System design for game world management
- **Real-time World State**: Dynamic inventory system, object interactions, and state tracking

## Architecture

### File Structure

```
src/app/ai-world/
├── page.tsx                 # Main page component and orchestration
├── actions.ts              # Core action system (HTN + GOAP)
├── world-setup.ts          # World initialization and entity creation
├── types.ts                # Shared TypeScript types
├── components-3d.tsx       # Three.js 3D components (Scene, NPCs, Items)
├── ui-components.tsx       # React UI components (Chat, Status, Logs)
├── ai-tools.ts             # Gemini AI tool definitions
└── README.md               # This file
```

### Core Systems

#### 1. Action System (`actions.ts`)

A sophisticated action system combining HTN (Hierarchical Task Network) and GOAP (Goal-Oriented Action Planning):

- **Actions**: Atomic operations (pick_up, go_to, give, use_machine_brew, etc.)
- **Predicates**: Conditions that must be met (reachable, nearby, in_inventory, etc.)
- **Effects**: State changes that occur after actions
- **HTN Planning**: Break complex goals into subtasks
- **Reservations**: Prevent race conditions on contested objects

Key classes:
- `World`: Central ECS-style world state
- `ActionRegistry`: Registry of all available actions
- `HTNExecutor`: Executes hierarchical task networks
- `EventBus`: Event system for action notifications

#### 2. World State (`world-setup.ts`)

Initializes the game world with:
- **Player Agent**: Main player character
- **NPCs**: Alice (barista) and Bob (repair specialist)
- **Items**: Mugs, keys, and other interactive objects
- **Machines**: Coffee machines and other equipment
- **Locations**: Kitchen, workshop, storage areas

#### 3. 3D Components (`components-3d.tsx`)

React Three Fiber components:
- `Ground`: Physics-enabled ground plane
- `Building`: 3D buildings with labels
- `WorldItem`: Pickable items rendered in 3D
- `WorldMachine`: Interactive machines
- `NpcCharacter`: Dynamic NPC characters with physics
- `PlayerController`: First-person camera and physics controller
- `Scene`: Main scene orchestrator

#### 4. AI Tools (`ai-tools.ts`)

Gemini AI tool definitions:
- `inspect_world`: Get complete world state
- `command_npc`: Issue commands to NPCs
- `check_inventory`: Inspect agent inventories
- `get_agent_info`: Get detailed agent information

#### 5. UI Components (`ui-components.tsx`)

React UI components:
- `WorldStatusPanel`: Real-time world statistics
- `ActionLog`: Event log display
- `ChatPanel`: AI chat interface
- `ApiKeyInput`: API key configuration

## Usage

### Basic Controls

- **Movement**: WASD or Arrow keys
- **Look**: Mouse (when pointer is locked)
- **Run**: Hold Shift
- **Jump**: Space
- **Pointer Lock**: Click on viewport (Esc to unlock)

### Chat Commands

Talk to the AI assistant naturally:

```
"What's in the world?"
"Tell Alice to pick up the red mug"
"Check Bob's inventory"
"Where is Alice?"
"Command Alice to go to the kitchen"
```

### Extending the System

#### Adding New Actions

1. Register action in `actions.ts`:

```typescript
Actions.register({
  id: "new_action",
  category: "Manipulation",
  parameters: ["actor", "target"],
  preconditions: [
    { name: "is_agent", args: ["$actor"] },
    { name: "nearby", args: ["$target", 1.5] }
  ],
  effects: [
    { op: "assert_fact", s: "$actor", p: "interacted", o: "$target" }
  ],
  duration: 1.0,
  execute: async ({ world, actor, params }) => {
    // Custom logic here
    return { status: "ok" }
  }
})
```

#### Adding New AI Tools

1. Add tool in `ai-tools.ts`:

```typescript
export function createAITools(worldRef, addLog) {
  return {
    // ... existing tools
    new_tool: tool({
      description: "Description of what this tool does",
      inputSchema: z.object({
        param: z.string().describe("Parameter description")
      }),
      execute: async ({ param }) => {
        const world = worldRef.current
        // Tool logic here
        return { success: true, message: "Done!" }
      }
    })
  }
}
```

#### Adding New NPCs

1. Add to `world-setup.ts`:

```typescript
const newNpc = newId("npc")
world.agents.set(newNpc, {
  name: "Charlie",
  speed: 1.7,
  faction: "friendly",
  motives: { hunger: 0.4, energy: 0.6, social: 0.5 },
  traits: ["brave", "clever"],
  skills: { combat: 0.8 },
  relations: {},
  blackboard: {}
})
```

## Technical Stack

- **React 18**: UI framework
- **Three.js**: 3D rendering
- **React Three Fiber**: React renderer for Three.js
- **Rapier**: Physics engine
- **Gemini AI**: LLM with tool calling
- **TypeScript**: Type-safe development
- **Tailwind CSS**: Styling

## What Currently Works ✅

### Fully Functional
1. **3D Exploration** - Complete first-person movement with physics (WASD + mouse look)
2. **AI Chat Integration** - Gemini 2.0 Flash with tool calling works perfectly
3. **World Inspection** - Query world state, see all agents/items/machines
4. **NPC Commands** - Send commands to NPCs via AI (acknowledged but not executed yet)
5. **Rich UI** - Detailed world state panel showing positions, inventories, NPC stats
6. **Real-time Updates** - World state updates in real-time
7. **Action Logging** - All actions logged with timestamps

### Partially Working ⏳
1. **NPC Action Execution** - Commands are received and acknowledged but not yet executed in 3D world
2. **Inventory System** - State is tracked but pick up/drop interactions not hooked up to player controls
3. **Machine Interactions** - State tracked but no visual feedback for usage

### How to Use the Page
1. **Movement**: Click the 3D view to lock pointer, then:
   - `W/↑` - Forward, `S/↓` - Backward, `A/←` - Left, `D/→` - Right
   - `Space` - Jump, `Shift` - Sprint
   - `Mouse` - Look around, `Esc` - Unlock pointer

2. **AI Commands** (all working):
   - "What's in the world?" - Inspect environment
   - "Tell Alice to pick up the red mug" - Command NPCs
   - "Check Bob's inventory" - View items  
   - "Get info about Alice" - Agent details

3. **World View**: Right panel shows live state of all entities, inventories, and positions

### Known Limitations
- NPCs don't visually move yet (positions tracked but not rendered)
- Can't directly pick up items as player (must command NPCs)
- No player inventory UI for direct interaction
- Pointer lock doesn't work in automated testing (but works fine when used manually)

## Future Enhancements

- [ ] Implement actual NPC AI planning and execution
- [ ] Add more complex action sequences (craft, trade, combat)
- [ ] Implement social systems (reputation, factions)
- [ ] Add dialogue trees and branching conversations
- [ ] Expand world with more locations and objects
- [ ] Implement save/load system
- [ ] Add multiplayer support
- [ ] Integrate voice commands
- [ ] Add visual effects (particles, shaders)
- [ ] Implement dynamic time of day and weather

## Performance Considerations

- Physics updates run at 60 FPS
- World state updates every 100ms
- Chat uses streaming responses
- 3D rendering optimized with instancing and LOD

## Troubleshooting

### Common Issues

**Pointer lock not working**: Click directly on the 3D viewport, not on UI elements.

**NPCs not responding**: Commands are logged but not yet executed - implementation pending.

**Physics jitter**: Adjust gravity or collision margins in Physics component.

**Chat not working**: Ensure valid Google API key is entered and stored.

## License

Part of the Vibe City demo collection.

