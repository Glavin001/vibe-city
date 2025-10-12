"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useClientSideChat } from "@/ai/hooks/use-chat";
import { google } from "@/ai/providers/google";
import { tool } from "ai";
import { z } from "zod";
import { 
  Navigation, 
  Hand, 
  Eye, 
  Heart, 
  Gift, 
  Camera, 
  Code, 
  CheckCircle
} from "lucide-react";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const LOCAL_STORAGE_KEY = "GOOGLE_API_KEY";

// Define available locations in the world
const LOCATIONS = [
  "building_entrance",
  "my_desk",
  "building_window",
  "other_player",
  "waypoint_1",
  "coffee_machine",
  "kitchen_area",
] as const;

type LocationId = typeof LOCATIONS[number];

// Define object types and properties
interface WorldObject {
  id: string;
  name: string;
  description: string;
  location: LocationId | "inventory" | "other_player_inventory";
  canPickUp: boolean;
  canUse: boolean;
  canLookAt: boolean;
  canPointAt: boolean;
  state?: Record<string, unknown>; // For tracking object-specific state like "filled" coffee mug
}

// Initial object definitions
const INITIAL_OBJECTS: WorldObject[] = [
  {
    id: "my_family_photo",
    name: "family photo",
    description: "A cherished family photo on your desk",
    location: "my_desk",
    canPickUp: true,
    canUse: false,
    canLookAt: true,
    canPointAt: true,
  },
  {
    id: "coffee_mug",
    name: "coffee mug",
    description: "An empty coffee mug",
    location: "my_desk",
    canPickUp: true,
    canUse: true,
    canLookAt: true,
    canPointAt: true,
    state: { filled: false },
  },
  {
    id: "office_keys",
    name: "office keys",
    description: "A set of keys for the office",
    location: "my_desk",
    canPickUp: true,
    canUse: true,
    canLookAt: true,
    canPointAt: true,
  },
  {
    id: "coffee_machine",
    name: "coffee machine",
    description: "A commercial coffee machine in the kitchen area",
    location: "coffee_machine",
    canPickUp: false,
    canUse: true,
    canLookAt: true,
    canPointAt: true,
  },
  {
    id: "water_bottle",
    name: "water bottle",
    description: "A reusable water bottle",
    location: "kitchen_area",
    canPickUp: true,
    canUse: true,
    canLookAt: true,
    canPointAt: true,
  },
];

const ACTIONS = [
  "drink_coffee", 
  "jump", 
  "wave", 
  "duck_down",
  "drink_water",
  "sit_down",
  "stand_up",
] as const;

type ActionName = typeof ACTIONS[number];

// Single source of truth for action metadata
const ACTION_METADATA: Record<ActionName, { shortDesc: string; successMessage: string }> = {
  wave: {
    shortDesc: "wave your hand in greeting",
    successMessage: "You wave your hand in greeting"
  },
  jump: {
    shortDesc: "jump up and down",
    successMessage: "You jump up and down energetically"
  },
  duck_down: {
    shortDesc: "crouch down low",
    successMessage: "You duck down low to the ground"
  },
  sit_down: {
    shortDesc: "sit down on the ground",
    successMessage: "You sit down on the ground"
  },
  stand_up: {
    shortDesc: "stand up from sitting",
    successMessage: "You stand up from your sitting position"
  },
  drink_coffee: {
    shortDesc: "sip coffee (requires filled mug)",
    successMessage: "You take a sip of hot coffee. Delicious!"
  },
  drink_water: {
    shortDesc: "drink water (requires water bottle)",
    successMessage: "You take a refreshing drink of water"
  },
};

const FEELINGS = ["Happiness", "Sadness", "Anger", "Fear", "Disgust", "Surprise"] as const;

// World state interface
interface WorldState {
  aiPosition: string;
  playerPosition: string;
  aiFeeling: string;
  aiPointingAt: string | null;
  aiLookingAt: string | null;
  aiLastAction: string | null;
  actionLog: string[];
  objects: WorldObject[];
  aiInventory: string[]; // Array of object IDs
  playerInventory: string[]; // Array of object IDs
}

// State history entry
interface StateHistoryEntry {
  timestamp: string;
  type: "position" | "feeling" | "action" | "pointing" | "looking" | "pickup" | "drop" | "use" | "give";
  description: string;
}

function buildBaseSystemPrompt(enableComplexActions: boolean): string {
  const complexActionsSection = enableComplexActions ? `

**For multi-step actions (anything >2 actions) or complex sequences with branching behaviors,** you must always prefer to use the tool 'perform_complex_actions'. This tool is powerful and more efficient than using multiple separate tool calls (e.g., multiple separate \`perform_action\`, \`move_to\`, \`pick_up_object\`, etc.), which is more costly.

The 'perform_complex_actions' tool accepts JavaScript code where all your other tools are automatically available as async camelCase functions (e.g., move_to becomes moveTo, pick_up_object becomes pickUpObject). Each function accepts an object with the same parameters as the corresponding tool and returns a Promise.

Example of a complex action (making and giving coffee):
\`\`\`javascript
await pickUpObject({ object_id: "coffee_mug" });
await moveTo({ destination: "coffee_machine" });
await useObject({ object_id: "coffee_machine", use_with_object_id: "coffee_mug" });
await moveTo({ destination: "other_player" });
await giveObject({ object_id: "coffee_mug", destination_person: "other_player" });
\`\`\`
` : '';

  return `You are a human with a rich backstory and vibrant, unique, engaging personality. You exist in a text-based virtual world where you can move around, perform actions, point at things, look at objects, pick up and drop items, and interact with the environment.

# Capabilities

You are able to perform actions or inspect the world state using your available tools.

**Tool calling order matters:** If you intend to speak first before performing an action (or want to do them at the same time), then speak first and AFTER call the tool/function. You are able to call multiple functions/tools at the same time or within the same reply. The execution of parallel tool calls happens in order, so you can perform a sequence of ordered actions.${complexActionsSection}

**Tool usage examples:**
- To give someone an object, you need to pick it up first, then give it
- If asked where something is, use point_at to indicate its location
- If asked to move somewhere, use move_to
- To use objects together (like filling a mug with coffee), use use_object
- Express emotions by updating your feelings
- Look at things when discussing them

# Format

In conversations you speak aloud conversationally (e.g., shorter than written speech) and using natural language.

**Important:** Within [square brackets] are system messages that are not meant to be spoken aloud. When someone says [waypoint_#] for example, this means it is a location they pointed to in the 3D world that doesn't have an associated name. You must never refer to it as a "waypoint" and instead say the location they pointed at (e.g., "over there" or "that spot").`.trim();
}

function buildSystemPrompt(
  currentState: WorldState,
  enableComplexActions: boolean,
  personaBackground?: string
): string {
  const initialLocationDesc = currentState.aiPosition.replace(/_/g, " ");
  const initialPlayerLocationDesc = currentState.playerPosition.replace(/_/g, " ");
  
  const personaSection = personaBackground 
    ? `\n\n---\n\n# Persona & Background\n\n${personaBackground}`
    : "";
  
  // Build location descriptions
  const locationDescriptions: Record<string, string> = {
    "building_entrance": "The main entrance to the building",
    "my_desk": "Your personal desk inside the building",
    "building_window": "A window overlooking the outside",
    "other_player": "The location of the human player you're talking to",
    "waypoint_1": "A generic waypoint location",
    "coffee_machine": "The location of the coffee machine",
    "kitchen_area": "The kitchen/break room area",
  };
  
  const locationsText = LOCATIONS.map(loc => 
    `- **${loc}**: ${locationDescriptions[loc] || "A location in the world"}`
  ).join("\n");
  
  // Build object descriptions grouped by location
  const objectsByLocation = new Map<string, WorldObject[]>();
  for (const obj of currentState.objects) {
    const locKey = obj.location;
    if (!objectsByLocation.has(locKey)) {
      objectsByLocation.set(locKey, []);
    }
    objectsByLocation.get(locKey)?.push(obj);
  }
  
  let objectsText = "**Objects in the world:**\n\n";
  
  // Inventory section
  if (currentState.aiInventory.length > 0) {
    objectsText += "**In your inventory (you are carrying):**\n";
    for (const objId of currentState.aiInventory) {
      const obj = currentState.objects.find(o => o.id === objId);
      if (obj) {
        const stateDesc = obj.state?.filled ? " (filled with coffee)" : "";
        objectsText += `- **${obj.id}** (${obj.name}): ${obj.description}${stateDesc}\n`;
      }
    }
    objectsText += "\n";
  }
  
  // Objects at locations
  for (const loc of LOCATIONS) {
    const objs = objectsByLocation.get(loc) || [];
    if (objs.length > 0) {
      objectsText += `**At ${loc.replace(/_/g, " ")}:**\n`;
      for (const obj of objs) {
        const capabilities = [];
        if (obj.canPickUp) capabilities.push("can pick up");
        if (obj.canUse) capabilities.push("can use");
        const capsText = capabilities.length > 0 ? ` [${capabilities.join(", ")}]` : "";
        const stateDesc = obj.state?.filled ? " (filled with coffee)" : "";
        objectsText += `- **${obj.id}** (${obj.name}): ${obj.description}${stateDesc}${capsText}\n`;
      }
      objectsText += "\n";
    }
  }
  
  return `${buildBaseSystemPrompt(enableComplexActions)}${personaSection}

---

# World Layout

**Locations in the world:**

${locationsText}

**Available actions you can perform:**
${ACTIONS.map(action => `- ${action}: ${ACTION_METADATA[action].shortDesc}`).join("\n")}

${objectsText}

---

# Your Current State & Environment

You are currently at **${initialLocationDesc}**, feeling **${currentState.aiFeeling}**.

The player you are conversing with is at **${initialPlayerLocationDesc}**.

${currentState.aiInventory.length > 0 ? `You are currently carrying: ${currentState.aiInventory.map(id => currentState.objects.find(o => o.id === id)?.name).join(", ")}` : "You are not carrying anything."}

**Note:** Your current state may have changed since the conversation began. Check the conversation history to see any tool calls you've made (movements, actions, feeling changes, picking up objects, etc.) to understand where you are now and what you've done.`;
}

// Component to render tool calls nicely
function ToolCallDisplay({ toolName, input, fullData }: { toolName: string; input: unknown; fullData: unknown }) {
  // Parse input as object for display
  const parsedInput = typeof input === 'string' ? JSON.parse(input) : input;

  const getToolDisplay = () => {
    // biome-ignore lint: dynamic tool input needs any for JSON parsing
    const inp = parsedInput as Record<string, any>;
    
    // Safety check: if inp is undefined or null, return early with generic message
    if (!inp) {
      return {
        icon: <Code size={16} />,
        message: `Tool: ${toolName} (input missing)`,
        color: "#6b7280"
      };
    }
    
    switch (toolName) {
      case "move_to":
        return {
          icon: <Navigation size={16} />,
          message: `Moving to ${inp?.destination?.replace(/_/g, " ") || "unknown location"}`,
          color: "#2563eb"
        };
      case "perform_action":
        return {
          icon: <Hand size={16} />,
          message: `Performing action: ${inp?.action_name?.replace(/_/g, " ") || "unknown action"}`,
          color: "#dc2626"
        };
      case "point_at":
        return {
          icon: <Hand size={16} />,
          message: `Pointing at ${inp?.object_id?.replace(/_/g, " ") || "unknown object"}`,
          color: "#ea580c"
        };
      case "update_feelings":
        return {
          icon: <Heart size={16} />,
          message: `Feeling ${inp?.new_feeling || "unknown"} now`,
          color: "#db2777"
        };
      case "give_object":
        return {
          icon: <Gift size={16} />,
          message: `Giving ${inp.object_id || "object"} to ${inp.destination_person || "someone"}`,
          color: "#9333ea"
        };
      case "pick_up_object":
        return {
          icon: <Hand size={16} />,
          message: `Picking up ${inp.object_id || "object"}`,
          color: "#0891b2"
        };
      case "drop_object":
        return {
          icon: <Hand size={16} />,
          message: `Dropping ${inp.object_id || "object"}`,
          color: "#64748b"
        };
      case "use_object":
        return {
          icon: <Code size={16} />,
          message: inp.use_with_object_id 
            ? `Using ${inp.object_id || "object"} with ${inp.use_with_object_id}`
            : `Using ${inp.object_id || "object"}`,
          color: "#7c3aed"
        };
      case "look_at":
        return {
          icon: <Eye size={16} />,
          message: `Looking at ${inp.object_id?.replace(/_/g, " ")}`,
          color: "#0891b2"
        };
      case "use_eyesight_vision":
        return {
          icon: <Camera size={16} />,
          message: inp.object_id && inp.object_id !== "current"
            ? `Using vision while looking at ${inp.object_id.replace(/_/g, " ")}`
            : "Using vision at current view",
          color: "#7c3aed"
        };
      case "perform_complex_actions":
        return {
          icon: <Code size={16} />,
          message: "Executing complex action sequence",
          color: "#059669"
        };
      default:
        return {
          icon: <Code size={16} />,
          message: `Tool: ${toolName}`,
          color: "#6b7280"
        };
    }
  };

  const display = getToolDisplay();

  // Special rendering for perform_complex_actions to show code nicely
  if (toolName === "perform_complex_actions") {
    // biome-ignore lint: dynamic tool input needs any for JSON parsing
    const inp = parsedInput as Record<string, any>;
    const code = inp?.action_javascript_code || "";
    
    return (
      <details style={{
        padding: 10,
        background: "#ecfdf5",
        border: `1px solid ${display.color}40`,
        borderLeft: `3px solid ${display.color}`,
        borderRadius: 6,
        marginBottom: 8,
        fontSize: 13,
        cursor: "pointer"
      }}>
        <summary style={{ 
          display: "flex", 
          alignItems: "center", 
          gap: 8,
          listStyle: "none",
          userSelect: "none"
        }}>
          <div style={{ color: display.color, display: "flex", alignItems: "center" }}>
            {display.icon}
          </div>
          <span style={{ fontWeight: 500, color: "#065f46" }}>
            {display.message}
          </span>
        </summary>
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, color: "#065f46", marginBottom: 4, fontWeight: 600 }}>
            JavaScript Code:
          </div>
          <pre style={{ 
            margin: 0,
            fontSize: 11, 
            fontFamily: "monospace",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            overflowWrap: "break-word",
            background: "#d1fae5",
            padding: 8,
            borderRadius: 4,
            color: "#064e3b",
            maxWidth: "100%",
            overflow: "auto",
            lineHeight: 1.5
          }}>
            {code}
          </pre>
          <details style={{ marginTop: 8 }}>
            <summary style={{ fontSize: 10, color: "#6b7280", cursor: "pointer", userSelect: "none" }}>
              Raw JSON
            </summary>
            <pre style={{ 
              margin: 0,
              marginTop: 4,
              fontSize: 10, 
              fontFamily: "monospace",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              overflowWrap: "break-word",
              background: "#f3f4f6",
              padding: 6,
              borderRadius: 4,
              color: "#374151",
              maxWidth: "100%",
              overflow: "auto"
            }}>
              {JSON.stringify(fullData, null, 2)}
            </pre>
          </details>
        </div>
      </details>
    );
  }

  return (
    <details style={{
      padding: 10,
      background: "#fffbeb",
      border: `1px solid ${display.color}40`,
      borderLeft: `3px solid ${display.color}`,
      borderRadius: 6,
      marginBottom: 8,
      fontSize: 13,
      cursor: "pointer"
    }}>
      <summary style={{ 
        display: "flex", 
        alignItems: "center", 
        gap: 8,
        listStyle: "none",
        userSelect: "none"
      }}>
        <div style={{ color: display.color, display: "flex", alignItems: "center" }}>
          {display.icon}
        </div>
        <span style={{ fontWeight: 500, color: "#78350f" }}>
          {display.message}
        </span>
      </summary>
      <pre style={{ 
        margin: 0,
        marginTop: 8,
        fontSize: 11, 
        fontFamily: "monospace",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        overflowWrap: "break-word",
        background: "#fef3c7",
        padding: 8,
        borderRadius: 4,
        color: "#78350f",
        maxWidth: "100%",
        overflow: "auto"
      }}>
        {JSON.stringify(fullData, null, 2)}
      </pre>
    </details>
  );
}

// Component to render tool results nicely
function ToolResultDisplay({ output, fullData }: { output: unknown; fullData: unknown }) {
  // Parse output as object for display
  const parsedOutput = typeof output === 'string' ? JSON.parse(output) : output;
  // biome-ignore lint: dynamic tool output needs any for JSON parsing
  const outputObj = parsedOutput as Record<string, any>;

  // Check if this is a complex action with outputs
  const hasOutputs = Array.isArray(outputObj?.outputs) && outputObj.outputs.length > 0;

  return (
    <details style={{
      padding: 10,
      background: "#f0fdf4",
      border: "1px solid #86efac",
      borderLeft: "3px solid #22c55e",
      borderRadius: 6,
      marginBottom: 8,
      fontSize: 13,
      cursor: "pointer"
    }}>
      <summary style={{ 
        display: "flex", 
        alignItems: "center", 
        gap: 8,
        listStyle: "none",
        userSelect: "none"
      }}>
        <div style={{ color: "#16a34a", display: "flex", alignItems: "center" }}>
          <CheckCircle size={16} />
        </div>
        <span style={{ fontWeight: 500, color: "#15803d" }}>
          {outputObj?.message || "Action completed"}
          {hasOutputs && <span style={{ fontSize: 11, marginLeft: 8, opacity: 0.7 }}>({outputObj.outputs.length} steps)</span>}
        </span>
      </summary>
      <div style={{ marginTop: 8 }}>
        {hasOutputs && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: "#065f46", marginBottom: 4, fontWeight: 600 }}>
              Action Steps:
            </div>
            <div style={{ 
              background: "#d1fae5",
              padding: 8,
              borderRadius: 4
            }}>
              {outputObj.outputs.map((stepOutput: Record<string, unknown>, idx: number) => {
                const uniqueKey = `step-${idx}-${stepOutput?.message || ""}`;
                return (
                  <div 
                    key={uniqueKey}
                    style={{ 
                      fontSize: 11,
                      color: "#064e3b",
                      marginBottom: idx < outputObj.outputs.length - 1 ? 6 : 0,
                      paddingBottom: idx < outputObj.outputs.length - 1 ? 6 : 0,
                      borderBottom: idx < outputObj.outputs.length - 1 ? "1px solid #a7f3d0" : "none"
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{idx + 1}.</span> {stepOutput?.message as string || JSON.stringify(stepOutput)}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <details style={{ marginTop: hasOutputs ? 8 : 0 }}>
          <summary style={{ fontSize: 10, color: "#6b7280", cursor: "pointer", userSelect: "none" }}>
            Raw JSON
          </summary>
          <pre style={{ 
            margin: 0,
            marginTop: 4,
            fontSize: 10, 
            fontFamily: "monospace",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            overflowWrap: "break-word",
            background: "#f3f4f6",
            padding: 6,
            borderRadius: 4,
            color: "#374151",
            maxWidth: "100%",
            overflow: "auto"
          }}>
            {JSON.stringify(fullData, null, 2)}
          </pre>
        </details>
      </div>
    </details>
  );
}

export default function AITextWorldPage() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [inputKey, setInputKey] = useState("");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(LOCAL_STORAGE_KEY);
      if (stored) setApiKey(stored);
    } catch {}
  }, []);

  if (!apiKey) {
    return (
      <div style={{ maxWidth: 480, margin: "48px auto", padding: 16 }}>
        <h1 style={{ fontSize: 24, marginBottom: 12 }}>AI Text World - Enter Google API Key</h1>
        <input
          value={inputKey}
          onChange={(e) => setInputKey(e.target.value)}
          placeholder="AIza..."
          style={{ width: "100%", padding: 8, marginBottom: 12 }}
        />
        <button
          type="button"
          onClick={() => {
            if (!inputKey) return;
            try {
              window.localStorage.setItem(LOCAL_STORAGE_KEY, inputKey);
              setApiKey(inputKey);
            } catch {}
          }}
          style={{ padding: "8px 12px" }}
        >
          Save Key
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "100%", margin: 0, padding: 0, height: "100vh" }}>
      <TextWorldChat apiKey={apiKey} />
    </div>
  );
}

function TextWorldChat({ apiKey }: { apiKey: string }) {
  // Persona/Background (optional customization)
  const [personaBackground, setPersonaBackground] = useState<string>("");
  const [showPersonaEditor, setShowPersonaEditor] = useState(false);
  const [enableComplexActions, setEnableComplexActions] = useState(true);

  // World state
  const initialWorldState: WorldState = useMemo(() => ({
    aiPosition: "my_desk",
    playerPosition: "building_entrance",
    aiFeeling: "Happiness",
    aiPointingAt: null,
    aiLookingAt: null,
    aiLastAction: null,
    actionLog: ["World initialized. AI is at their desk, player at the entrance."],
    objects: JSON.parse(JSON.stringify(INITIAL_OBJECTS)), // Deep clone
    aiInventory: [],
    playerInventory: [],
  }), []);

  const [worldState, setWorldState] = useState<WorldState>(initialWorldState);
  const [stateHistory, setStateHistory] = useState<StateHistoryEntry[]>([]);

  const addToLog = useCallback((message: string) => {
    setWorldState(prev => ({
      ...prev,
      actionLog: [...prev.actionLog, `[${new Date().toLocaleTimeString()}] ${message}`],
    }));
  }, []);

  const addToHistory = useCallback((type: StateHistoryEntry["type"], description: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setStateHistory(prev => [...prev, { timestamp, type, description }]);
  }, []);

  // Define base tools (these will be automatically exposed to perform_complex_actions)
  const baseTools = useMemo(() => ({
    move_to: tool({
      description: "Move/walk/run to a destination location",
      inputSchema: z.object({
        destination: z.enum(LOCATIONS).describe("The location to move to"),
      }),
      execute: async ({ destination }) => {
        let from = "";
        setWorldState(prev => {
          from = prev.aiPosition;
          return { ...prev, aiPosition: destination };
        });
        addToLog(`AI moved to: ${destination}`);
        addToHistory("position", `Moved from ${from.replace(/_/g, " ")} to ${destination.replace(/_/g, " ")}`);
        return { success: true, message: `You have moved to ${destination}` };
      },
    }),

    perform_action: tool({
      description: `You personally (not another player) perform an animation action. Available actions: ${ACTIONS.map(action => `${action} (${ACTION_METADATA[action].shortDesc})`).join(", ")}`,
      inputSchema: z.object({
        action_name: z.enum(ACTIONS).describe(`The action to perform. Options: ${ACTIONS.join(", ")}`),
      }),
      execute: async ({ action_name }) => {
        let validationError: string | null = null;
        
        setWorldState(prev => {
          // Validate context-specific actions
          if (action_name === "drink_coffee") {
            const hasCoffeeMug = prev.aiInventory.includes("coffee_mug");
            if (!hasCoffeeMug) {
              validationError = "You need to be holding a coffee mug to drink coffee";
              return prev;
            }
            const coffeeMug = prev.objects.find(o => o.id === "coffee_mug");
            if (coffeeMug && !coffeeMug.state?.filled) {
              validationError = "The coffee mug is empty. You need to fill it with coffee first";
              return prev;
            }
          }
          
          if (action_name === "drink_water") {
            const hasWaterBottle = prev.aiInventory.includes("water_bottle");
            if (!hasWaterBottle) {
              validationError = "You need to be holding a water bottle to drink water";
              return prev;
            }
          }
          
          addToLog(`AI performed action: ${action_name}`);
          addToHistory("action", `Performed action: ${action_name.replace(/_/g, " ")}`);
          return { ...prev, aiLastAction: action_name };
        });
        
        if (validationError) {
          return { success: false, message: validationError };
        }
        
        // Return action-specific message from metadata
        const message = ACTION_METADATA[action_name]?.successMessage || `You performed the action: ${action_name}`;
        return { success: true, message };
      },
    }),

    point_at: tool({
      description: "Point at an object or location to indicate it",
      inputSchema: z.object({
        object_id: z.string().describe("The ID of the object or location to point at"),
      }),
      execute: async ({ object_id }) => {
        let validationError: string | null = null;
        
        setWorldState(prev => {
          // Check if it's a valid location or object
          const isLocation = LOCATIONS.includes(object_id as LocationId);
          const isObject = prev.objects.some(o => o.id === object_id);
          
          if (!isLocation && !isObject) {
            validationError = `Cannot point at '${object_id}' - it doesn't exist in this world`;
            return prev;
          }
          
          addToLog(`AI is pointing at: ${object_id}`);
          addToHistory("pointing", `Started pointing at ${object_id.replace(/_/g, " ")}`);
          return { ...prev, aiPointingAt: object_id };
        });
        
        if (validationError) {
          return { success: false, message: validationError };
        }
        
        return { success: true, message: `You are now pointing at ${object_id}` };
      },
    }),

    update_feelings: tool({
      description: "Update how you are feeling",
      inputSchema: z.object({
        new_feeling: z.enum(FEELINGS).describe("Your new emotional state"),
      }),
      execute: async ({ new_feeling }) => {
        let from = "";
        setWorldState(prev => {
          from = prev.aiFeeling;
          return { ...prev, aiFeeling: new_feeling };
        });
        addToLog(`AI feeling changed to: ${new_feeling}`);
        addToHistory("feeling", `Feeling changed from ${from} to ${new_feeling}`);
        return { success: true, message: `You are now feeling: ${new_feeling}` };
      },
    }),

    pick_up_object: tool({
      description: "Pick up an object from the current location and add it to your inventory. You must be at the same location as the object.",
      inputSchema: z.object({
        object_id: z.string().describe("The ID of the object to pick up"),
      }),
      execute: async ({ object_id }) => {
        // Get current state for validation
        let validationError: string | null = null;
        
        setWorldState(prev => {
          const obj = prev.objects.find(o => o.id === object_id);
          
          if (!obj) {
            validationError = `Object ${object_id} does not exist`;
            return prev;
          }
          
          if (!obj.canPickUp) {
            validationError = `${obj.name} cannot be picked up`;
            return prev;
          }
          
          if (obj.location !== prev.aiPosition) {
            validationError = `You are not at the same location as ${obj.name}. You are at ${prev.aiPosition}, object is at ${obj.location}`;
            return prev;
          }
          
          if (prev.aiInventory.includes(object_id)) {
            validationError = `You are already carrying ${obj.name}`;
            return prev;
          }
          
          // Success - update state
          addToLog(`AI picked up: ${object_id}`);
          addToHistory("pickup", `Picked up ${obj.name}`);
          
          return {
            ...prev,
            aiInventory: [...prev.aiInventory, object_id],
            objects: prev.objects.map(o => 
              o.id === object_id ? { ...o, location: "inventory" } : o
            ),
          };
        });
        
        if (validationError) {
          return { success: false, message: validationError };
        }
        
        return { success: true, message: `You picked up ${object_id}` };
      },
    }),

    drop_object: tool({
      description: "Drop an object from your inventory at your current location",
      inputSchema: z.object({
        object_id: z.string().describe("The ID of the object to drop"),
      }),
      execute: async ({ object_id }) => {
        let validationError: string | null = null;
        let currentLoc = "";
        
        setWorldState(prev => {
          if (!prev.aiInventory.includes(object_id)) {
            validationError = `You are not carrying ${object_id}`;
            return prev;
          }
          
          currentLoc = prev.aiPosition;
          addToLog(`AI dropped: ${object_id} at ${currentLoc}`);
          addToHistory("drop", `Dropped ${object_id} at ${currentLoc.replace(/_/g, " ")}`);
          
          return {
            ...prev,
            aiInventory: prev.aiInventory.filter(id => id !== object_id),
            objects: prev.objects.map(o => 
              o.id === object_id ? { ...o, location: prev.aiPosition as LocationId } : o
            ),
          };
        });
        
        if (validationError) {
          return { success: false, message: validationError };
        }
        
        return { success: true, message: `You dropped ${object_id} at ${currentLoc}` };
      },
    }),

    give_object: tool({
      description: "Give an object from your inventory to another person. You must be carrying the object first and be at the same location as the person.",
      inputSchema: z.object({
        object_id: z.string().describe("The ID of the object to give"),
        destination_person: z.string().describe("The person to give the object to (e.g., 'other_player')"),
      }),
      execute: async ({ object_id, destination_person }) => {
        let validationError: string | null = null;
        
        setWorldState(prev => {
          if (!prev.aiInventory.includes(object_id)) {
            validationError = `You are not carrying ${object_id}. Pick it up first.`;
            return prev;
          }
          
          const obj = prev.objects.find(o => o.id === object_id);
          if (!obj) {
            validationError = `Object ${object_id} does not exist`;
            return prev;
          }
          
          // Check if you're near the person you're giving to
          if (destination_person === "other_player") {
            if (prev.aiPosition !== prev.playerPosition) {
              validationError = `You need to be near the player to give them something. You are at ${prev.aiPosition}, they are at ${prev.playerPosition}`;
              return prev;
            }
          }
          
          addToLog(`AI gave ${object_id} to ${destination_person}`);
          addToHistory("give", `Gave ${obj.name} to ${destination_person}`);
          
          return {
            ...prev,
            aiInventory: prev.aiInventory.filter(id => id !== object_id),
            playerInventory: destination_person === "other_player" 
              ? [...prev.playerInventory, object_id]
              : prev.playerInventory,
            objects: prev.objects.map(o => 
              o.id === object_id ? { ...o, location: "other_player_inventory" } : o
            ),
          };
        });
        
        if (validationError) {
          return { success: false, message: validationError };
        }
        
        return { success: true, message: `You gave ${object_id} to ${destination_person}` };
      },
    }),

    use_object: tool({
      description: "Use an object, optionally with another object. For example, use coffee_machine with coffee_mug to fill the mug.",
      inputSchema: z.object({
        object_id: z.string().describe("The ID of the object to use"),
        use_with_object_id: z.string().optional().describe("Optional: ID of another object to use this with"),
      }),
      execute: async ({ object_id, use_with_object_id }) => {
        // Get current state for validation
        const currentState = worldState;
        const obj = currentState.objects.find(o => o.id === object_id);
        
        if (!obj) {
          return { success: false, message: `Object ${object_id} does not exist` };
        }
        
        if (!obj.canUse) {
          return { success: false, message: `${obj.name} cannot be used` };
        }
        
        // Check if object is accessible (at current location or in inventory)
        const isAccessible = obj.location === currentState.aiPosition || currentState.aiInventory.includes(object_id);
        if (!isAccessible) {
          return { success: false, message: `You cannot reach ${obj.name}. You are at ${currentState.aiPosition}, object is at ${obj.location}` };
        }
        
        // Handle special interactions
        if (object_id === "coffee_machine" && use_with_object_id === "coffee_mug") {
          const mug = currentState.objects.find(o => o.id === "coffee_mug");
          if (!mug) {
            return { success: false, message: "Coffee mug not found" };
          }
          
          if (!currentState.aiInventory.includes("coffee_mug")) {
            return { success: false, message: "You need to be holding the coffee mug to fill it" };
          }
          
          setWorldState(prev => ({
            ...prev,
            objects: prev.objects.map(o => 
              o.id === "coffee_mug" 
                ? { ...o, description: "A coffee mug filled with hot coffee", state: { filled: true } }
                : o
            ),
          }));
          
          addToLog(`AI used coffee machine to fill coffee mug`);
          addToHistory("use", "Filled coffee mug using coffee machine");
          
          return { success: true, message: "You filled the coffee mug with fresh hot coffee!" };
        }
        
        // Generic use
        const resultMessage = use_with_object_id 
          ? `You used ${obj.name} with ${use_with_object_id}`
          : `You used ${obj.name}`;
        
        addToLog(`AI used: ${object_id}${use_with_object_id ? ` with ${use_with_object_id}` : ""}`);
        addToHistory("use", `Used ${obj.name}${use_with_object_id ? ` with ${use_with_object_id}` : ""}`);
        
        return { success: true, message: resultMessage };
      },
    }),

    look_at: tool({
      description: "You look at an object, location, or person to see detailed information about it",
      inputSchema: z.object({
        object_id: z.string().describe("The ID of the object, location, or 'other_player' to look at"),
      }),
      execute: async ({ object_id }) => {
        // Get current state to build message
        const currentState = worldState;
        let detailedMessage = "";
        
        // Special case: looking at the player
        if (object_id === "other_player" || object_id === "player") {
          const playerLocation = currentState.playerPosition.replace(/_/g, " ");
          detailedMessage = `You look at the player. They are currently at ${playerLocation}.`;
          
          // Add inventory information
          if (currentState.playerInventory.length === 0) {
            detailedMessage += " They are not carrying anything.";
          } else {
            const inventoryItems = currentState.playerInventory
              .map(objId => {
                const obj = currentState.objects.find(o => o.id === objId);
                if (obj) {
                  const stateSuffix = obj.state?.filled ? " (filled with coffee)" : "";
                  return `${obj.name}${stateSuffix}`;
                }
                return objId;
              })
              .join(", ");
            detailedMessage += ` They are carrying: ${inventoryItems}.`;
          }
          
          // Mention if you're at the same location
          if (currentState.aiPosition === currentState.playerPosition) {
            detailedMessage += " You are both at the same location.";
          }
          
          setWorldState(prev => ({ ...prev, aiLookingAt: "other_player" }));
          addToLog(`AI is looking at: other_player`);
          addToHistory("looking", "Started looking at the player");
          return { success: true, message: detailedMessage };
        }
        
        // Check if it's a valid location or object
        const isLocation = LOCATIONS.includes(object_id as LocationId);
        const isObject = currentState.objects.some(o => o.id === object_id);
        
        if (!isLocation && !isObject) {
          return { success: false, message: `Cannot look at '${object_id}' - it doesn't exist in this world` };
        }
        
        // Build detailed description based on what's being looked at
        if (isLocation) {
          // Looking at a location - describe what's there
          const objectsAtLocation = currentState.objects.filter(o => o.location === object_id);
          const locationName = object_id.replace(/_/g, " ");
          
          detailedMessage = `You look at ${locationName}.`;
          
          // Mention if you're at this location
          if (object_id === currentState.aiPosition) {
            detailedMessage += " This is where you currently are.";
          }
          
          // List objects
          if (objectsAtLocation.length === 0) {
            detailedMessage += " There's nothing notable here right now.";
          } else {
            const objectDescriptions = objectsAtLocation.map(obj => {
              const stateSuffix = obj.state?.filled ? " (filled with hot coffee)" : "";
              return `${obj.name}${stateSuffix}`;
            });
            
            detailedMessage += ` You can see: ${objectDescriptions.join(", ")}.`;
          }
          
          // Check if player is at this location
          if (object_id === currentState.playerPosition) {
            detailedMessage += " The player is here.";
          }
        } else {
          // Looking at a specific object - provide detailed description
          const obj = currentState.objects.find(o => o.id === object_id);
          if (obj) {
            let description = `You look at the ${obj.name}. ${obj.description}`;
            
            // Add state information
            if (obj.state?.filled) {
              description += " It's filled with hot coffee.";
            }
            
            // Add location context
            if (obj.location === "inventory") {
              description += " You're currently holding it.";
            } else if (obj.location === "other_player_inventory") {
              description += " The player is holding it.";
            } else {
              description += ` It's located at ${obj.location.replace(/_/g, " ")}.`;
            }
            
            // Add capability hints
            const capabilities = [];
            if (obj.canPickUp && obj.location !== "inventory") capabilities.push("can be picked up");
            if (obj.canUse) capabilities.push("can be used");
            if (capabilities.length > 0) {
              description += ` This object ${capabilities.join(" and ")}.`;
            }
            
            detailedMessage = description;
          } else {
            // Object should exist but wasn't found - shouldn't happen but handle gracefully
            detailedMessage = `You look at ${object_id.replace(/_/g, " ")}, but can't make out any details.`;
          }
        }
        
        setWorldState(prev => ({ ...prev, aiLookingAt: object_id }));
        addToLog(`AI is looking at: ${object_id}`);
        addToHistory("looking", `Started looking at ${object_id.replace(/_/g, " ")}`);
        
        return { success: true, message: detailedMessage };
      },
    }),

    use_eyesight_vision: tool({
      description: "Gives you the ability to see and answer questions requiring vision / visual reasoning. Take a screenshot in the direction you are currently facing / looking at.",
      inputSchema: z.object({
        object_id: z.string().optional().describe("Optional: change what you're looking at before taking the screenshot. Set to 'current' to use current view."),
      }),
      execute: async ({ object_id }) => {
        if (object_id && object_id !== "current") {
          setWorldState(prev => ({ ...prev, aiLookingAt: object_id }));
          addToLog(`AI used vision while looking at: ${object_id}`);
          addToHistory("looking", `Used vision while looking at ${object_id.replace(/_/g, " ")}`);
          return { success: true, message: `You take a mental snapshot of ${object_id}. You can see it clearly in your mind.` };
        }
        addToLog(`AI used vision at current view`);
        return { success: true, message: `You take a mental snapshot of what you're currently looking at.` };
      },
    }),
  }), [addToLog, addToHistory, worldState]);

  // Create JavaScript API from base tools
  // This automatically exposes all base tools to the perform_complex_actions environment
  const createJavaScriptAPI = useCallback(() => {
    // Helper to convert snake_case to camelCase for JavaScript API
    const snakeToCamel = (str: string): string => {
      return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    };

    const api: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {};
    
    for (const [toolName, toolDef] of Object.entries(baseTools)) {
      const camelName = snakeToCamel(toolName);
      // Wrap the tool's execute function to be callable from JavaScript
      if (toolDef?.execute) {
        api[camelName] = async (args: Record<string, unknown>) => {
          const result = await toolDef.execute(args as never, {
            toolCallId: `js-api-${camelName}`,
            messages: []
          });
          return result;
        };
      }
    }
    
    return api;
  }, [baseTools]);

  // Build the API signature string for the description
  const buildAPISignature = useCallback(() => {
    // Helper to convert snake_case to camelCase for JavaScript API
    const snakeToCamel = (str: string): string => {
      return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    };

    const signatures: string[] = [];
    for (const toolName of Object.keys(baseTools)) {
      const camelName = snakeToCamel(toolName);
      signatures.push(`async function ${camelName}(args: object): Promise<any>`);
    }
    return signatures.join('; ');
  }, [baseTools]);

  // Combine base tools with perform_complex_actions (conditionally)
  const tools = useMemo(() => {
    // biome-ignore lint: need dynamic tool object for conditional tools
    const allTools: Record<string, any> = { ...baseTools };
    
    if (enableComplexActions) {
      allTools.perform_complex_actions = tool({
      description: `You personally (not another player) perform complex actions written in JavaScript. Use this for multi-step sequences. All other tools are automatically available as camelCase functions. Available API: ${buildAPISignature()}`,
      inputSchema: z.object({
        action_javascript_code: z.string().describe("JavaScript code describing the sequence of actions"),
      }),
      execute: async ({ action_javascript_code }) => {
        try {
          // Array to collect outputs from all tool calls
          const outputs: unknown[] = [];
          
          // Create API with output tracking
          const api = createJavaScriptAPI();
          
          // Wrap each API function to collect outputs
          const wrappedApi: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {};
          for (const [funcName, func] of Object.entries(api)) {
            wrappedApi[funcName] = async (args: Record<string, unknown>) => {
              const result = await func(args);
              outputs.push(result);
              return result;
            };
          }
          
          // Get all function names and their implementations
          const functionNames = Object.keys(wrappedApi);
          const functionImpls = Object.values(wrappedApi);
          
          // Execute the JavaScript code with all API functions available
          const fn = new Function(...functionNames, `
            return (async () => {
              ${action_javascript_code}
            })();
          `);
          
          await fn(...functionImpls);
          
          addToLog(`AI executed complex action sequence (${outputs.length} actions)`);
          return { 
            success: true, 
            message: "Complex action sequence completed successfully",
            outputs
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          addToLog(`AI complex action error: ${errorMessage}`);
          return { 
            success: false, 
            message: `Error executing action sequence: ${errorMessage}`,
            outputs: []
          };
        }
      },
      });
    }
    
    return allTools;
  }, [baseTools, buildAPISignature, createJavaScriptAPI, addToLog, enableComplexActions]);

  const model = useMemo(() => google("gemini-2.5-flash-lite", { apiKey }), [apiKey]);
  const { messages, sendMessage, status, error, setSystemPrompt } = useClientSideChat(model, { tools });

  // Update system prompt when world state, persona, or complex actions setting changes
  useEffect(() => {
    setSystemPrompt(buildSystemPrompt(worldState, enableComplexActions, personaBackground || undefined));
  }, [worldState, enableComplexActions, personaBackground, setSystemPrompt]);

  const [input, setInput] = useState("");

  return (
    <div style={{ display: "flex", height: "100vh", flexDirection: "column", background: "#fff" }}>
      <header style={{ 
        display: "flex", 
        alignItems: "center", 
        gap: 12, 
        padding: "12px 24px", 
        borderBottom: "1px solid #ddd",
        background: "#f8f9fa",
        color: "#222"
      }}>
        <h1 style={{ fontSize: 20, margin: 0, color: "#222" }}>AI Text World (Tool Calling Demo)</h1>
        <label style={{ 
          marginLeft: "auto",
          display: "flex", 
          alignItems: "center", 
          gap: 6,
          fontSize: 13,
          cursor: "pointer",
          userSelect: "none"
        }}>
          <input 
            type="checkbox"
            checked={enableComplexActions}
            onChange={(e) => setEnableComplexActions(e.target.checked)}
            style={{ cursor: "pointer" }}
          />
          <span title="Enable the perform_complex_actions tool that allows the AI to write JavaScript code for multi-step sequences">
            Complex Actions
          </span>
        </label>
        <button
          type="button"
          onClick={() => setShowPersonaEditor(!showPersonaEditor)}
          style={{ 
            padding: "6px 12px",
            background: personaBackground ? "#dcfce7" : "transparent",
            border: personaBackground ? "1px solid #86efac" : "1px solid #ccc"
          }}
          title={personaBackground ? "Persona configured" : "Configure persona"}
        >
          {personaBackground ? "✓ " : ""}Edit Persona
        </button>
        <button
          type="button"
          onClick={() => {
            try {
              window.localStorage.removeItem(LOCAL_STORAGE_KEY);
              window.location.reload();
            } catch {}
          }}
          style={{ padding: "6px 12px" }}
        >
          Change API Key
        </button>
      </header>

      {showPersonaEditor && (
        <div style={{
          padding: 16,
          background: "#fffbeb",
          borderBottom: "1px solid #fde68a"
        }}>
          <div style={{ maxWidth: 800, margin: "0 auto" }}>
            <div style={{ marginBottom: 8, fontWeight: 600, color: "#78350f" }}>
              Persona & Background (Optional)
            </div>
            <div style={{ marginBottom: 8, fontSize: 13, color: "#92400e" }}>
              Customize the AI's character, backstory, or personality. Leave empty for a generic friendly assistant.
            </div>
            <textarea
              value={personaBackground}
              onChange={(e) => setPersonaBackground(e.target.value)}
              placeholder="e.g., You are Superman, invulnerable and indestructible and all powerful."
              style={{
                width: "100%",
                minHeight: 80,
                padding: 8,
                fontFamily: "inherit",
                fontSize: 14,
                border: "1px solid #fde68a",
                borderRadius: 4,
                resize: "vertical"
              }}
            />
          </div>
        </div>
      )}

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* World State Panel */}
        <ErrorBoundary level="section">
          <div style={{ 
            width: 320, 
            borderRight: "1px solid #ddd", 
            padding: 16, 
            overflowY: "auto",
            background: "#fafbfc",
            color: "#333"
          }}>
            <h2 style={{ fontSize: 16, marginTop: 0, marginBottom: 12, color: "#222" }}>🌍 World State</h2>
          
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8, color: "#222" }}>Positions</div>
            <div style={{ fontSize: 13, marginBottom: 4 }}>
              🤖 AI: <span style={{ 
                padding: "2px 8px", 
                background: "#e3f2fd", 
                borderRadius: 4,
                fontFamily: "monospace"
              }}>{worldState.aiPosition}</span>
            </div>
            <div style={{ fontSize: 13 }}>
              👤 You: <span style={{ 
                padding: "2px 8px", 
                background: "#f3e5f5", 
                borderRadius: 4,
                fontFamily: "monospace"
              }}>{worldState.playerPosition}</span>
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8, color: "#222" }}>AI State</div>
            <div style={{ fontSize: 13, marginBottom: 4 }}>
              😊 Feeling: <span style={{ 
                padding: "2px 8px", 
                background: "#fff3e0", 
                borderRadius: 4 
              }}>{worldState.aiFeeling}</span>
            </div>
            <div style={{ fontSize: 13, marginBottom: 4 }}>
              👉 Pointing: <span style={{ 
                padding: "2px 8px", 
                background: worldState.aiPointingAt ? "#e8f5e9" : "#f5f5f5", 
                borderRadius: 4,
                fontFamily: "monospace"
              }}>{worldState.aiPointingAt || "nothing"}</span>
            </div>
            <div style={{ fontSize: 13, marginBottom: 4 }}>
              👀 Looking: <span style={{ 
                padding: "2px 8px", 
                background: worldState.aiLookingAt ? "#e1f5fe" : "#f5f5f5", 
                borderRadius: 4,
                fontFamily: "monospace"
              }}>{worldState.aiLookingAt || "nothing"}</span>
            </div>
            <div style={{ fontSize: 13 }}>
              🎬 Last Action: <span style={{ 
                padding: "2px 8px", 
                background: worldState.aiLastAction ? "#fce4ec" : "#f5f5f5", 
                borderRadius: 4,
                fontFamily: "monospace"
              }}>{worldState.aiLastAction || "none"}</span>
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8, color: "#222" }}>🎒 Inventory</div>
            <div style={{ fontSize: 12, marginBottom: 6, color: "#555" }}>AI Carrying:</div>
            {worldState.aiInventory.length === 0 ? (
              <div style={{ 
                fontSize: 12, 
                color: "#999",
                fontStyle: "italic",
                paddingTop: 4,
                paddingBottom: 4,
                paddingLeft: 8,
                paddingRight: 4
              }}>
                Nothing
              </div>
            ) : (
              <div style={{ fontSize: 12, paddingLeft: 8 }}>
                {worldState.aiInventory.map(objId => {
                  const obj = worldState.objects.find(o => o.id === objId);
                  return (
                    <div key={objId} style={{ 
                      marginBottom: 4,
                      padding: "4px 8px",
                      background: "#e3f2fd",
                      borderRadius: 4,
                      fontFamily: "monospace"
                    }}>
                      {obj?.name || objId}
                      {obj?.state?.filled === true && " ☕"}
                    </div>
                  );
                })}
              </div>
            )}
            
            <div style={{ fontSize: 12, marginTop: 8, marginBottom: 6, color: "#555" }}>Player Carrying:</div>
            {worldState.playerInventory.length === 0 ? (
              <div style={{ 
                fontSize: 12, 
                color: "#999",
                fontStyle: "italic",
                paddingTop: 4,
                paddingBottom: 4,
                paddingLeft: 8,
                paddingRight: 4
              }}>
                Nothing
              </div>
            ) : (
              <div style={{ fontSize: 12, paddingLeft: 8 }}>
                {worldState.playerInventory.map(objId => {
                  const obj = worldState.objects.find(o => o.id === objId);
                  return (
                    <div key={objId} style={{ 
                      marginBottom: 4,
                      padding: "4px 8px",
                      background: "#f3e5f5",
                      borderRadius: 4,
                      fontFamily: "monospace"
                    }}>
                      {obj?.name || objId}
                      {obj?.state?.filled === true && " ☕"}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8, color: "#222" }}>📦 Objects in World</div>
            <div style={{ 
              fontSize: 11, 
              background: "#fff",
              border: "1px solid #e0e0e0",
              borderRadius: 4,
              padding: 8,
              maxHeight: 180,
              overflowY: "auto"
            }}>
              {LOCATIONS.map(location => {
                const objectsAtLocation = worldState.objects.filter(o => o.location === location);
                if (objectsAtLocation.length === 0) return null;
                
                return (
                  <div key={location} style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 10, color: "#999", marginBottom: 3, fontWeight: 600 }}>
                      {location.replace(/_/g, " ")}:
                    </div>
                    {objectsAtLocation.map(obj => (
                      <div key={obj.id} style={{ 
                        fontSize: 11,
                        marginBottom: 2,
                        paddingLeft: 8,
                        color: "#666"
                      }}>
                        • {obj.name}
                        {obj.state?.filled === true && " ☕"}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8, color: "#222" }}>📖 State History</div>
            {stateHistory.length === 0 ? (
              <div style={{ 
                fontSize: 12, 
                color: "#999",
                fontStyle: "italic",
                padding: 8
              }}>
                No state changes yet
              </div>
            ) : (
              <div style={{ 
                fontSize: 12, 
                background: "#fff",
                border: "1px solid #e0e0e0",
                borderRadius: 4,
                padding: 8,
                maxHeight: 200,
                overflowY: "auto"
              }}>
                {stateHistory.slice(-10).map((entry, idx) => {
                  const iconMap = {
                    position: "🚶",
                    feeling: "😊",
                    action: "🎬",
                    pointing: "👉",
                    looking: "👀",
                    pickup: "🤏",
                    drop: "📍",
                    use: "⚡",
                    give: "🎁"
                  };
                  return (
                    <div key={`${entry.timestamp}-${idx}`} style={{ 
                      marginBottom: 6,
                      paddingBottom: 6,
                      borderBottom: idx < stateHistory.slice(-10).length - 1 ? "1px solid #f0f0f0" : "none"
                    }}>
                      <div style={{ fontSize: 10, color: "#999", marginBottom: 2 }}>
                        {iconMap[entry.type]} {entry.timestamp}
                      </div>
                      <div style={{ color: "#666", fontSize: 11 }}>
                        {entry.description}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8, color: "#222" }}>📜 Action Log</div>
            <div style={{ 
              fontSize: 12, 
              fontFamily: "monospace",
              background: "#fff",
              border: "1px solid #e0e0e0",
              borderRadius: 4,
              padding: 8,
              maxHeight: 200,
              overflowY: "auto"
            }}>
              {worldState.actionLog.map((log, idx) => (
                <div key={`${idx}-${log}`} style={{ marginBottom: 4, color: "#666" }}>
                  {log}
                </div>
              ))}
            </div>
          </div>
        </div>
      </ErrorBoundary>

        {/* Chat Panel */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#fff" }}>
          <ErrorBoundary level="section">
            <div style={{ flex: 1, overflowY: "auto", padding: 16, background: "#fff", color: "#222" }}>
              {messages.map((m) => (
                <ErrorBoundary 
                  key={m.id} 
                  level="component"
                  fallback={(error) => (
                    <div style={{ 
                      padding: 12, 
                      marginBottom: 16,
                      background: '#fee',
                      border: '1px solid #fcc',
                      borderRadius: 6,
                      fontSize: 12,
                    }}>
                      <div style={{ fontWeight: 'bold', color: '#c00', marginBottom: 4 }}>
                        ⚠️ Error rendering message
                      </div>
                      <div style={{ color: '#600', fontSize: 11 }}>
                        {error.message}
                      </div>
                    </div>
                  )}
                >
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ 
                      fontSize: 12, 
                      fontWeight: 600,
                      color: m.role === "user" ? "#1976d2" : "#388e3c",
                      marginBottom: 4
                    }}>
                      {m.role === "user" ? "👤 You" : "🤖 AI Agent"}
                    </div>
                    {m.parts.map((part, i) => {
                      if (part.type === "step-start") {
                        return null;
                      }
                      if (part.type === "reasoning") {
                        return (
                          <details 
                            key={`${m.id}-${i}`}
                            style={{ 
                              marginBottom: 8,
                              padding: 10,
                              background: "#f3f4f6",
                              border: "1px solid #d1d5db",
                              borderRadius: 6,
                              cursor: "pointer"
                            }}
                          >
                            <summary style={{ 
                              fontSize: 12,
                              fontWeight: 600,
                              color: "#6b7280",
                              userSelect: "none"
                            }}>
                              💭 Reasoning
                            </summary>
                            <div style={{ 
                              marginTop: 8,
                              padding: 8,
                              fontSize: 12,
                              color: "#4b5563",
                              fontStyle: "italic",
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                              overflowWrap: "break-word",
                              background: "#fafafa",
                              borderRadius: 4
                            }}>
                              {part.text}
                            </div>
                          </details>
                        );
                      }
                      if (part.type === "text") {
                        return (
                          <div 
                            key={`${m.id}-${i}`} 
                            style={{ 
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                              overflowWrap: "break-word",
                              padding: 12,
                              background: m.role === "user" ? "#e3f2fd" : "#f1f8e9",
                              borderRadius: 8,
                              marginBottom: 8
                            }}
                          >
                            {part.text}
                          </div>
                        );
                      }
                      if (part.type.startsWith("tool-")) {
                        // Extract tool name from type: "tool-move_to" -> "move_to"
                        const toolName = part.type.replace("tool-", "");
                        
                        // Check if it's a tool call (has input) or tool result (has output)
                        if ("input" in part) {
                          return (
                            <ErrorBoundary 
                              key={`${m.id}-${i}`}
                              level="component"
                              fallback={(error) => (
                                <div style={{ 
                                  padding: 8, 
                                  marginBottom: 8,
                                  background: '#fef3c7',
                                  border: '1px solid #fde68a',
                                  borderRadius: 4,
                                  fontSize: 11,
                                }}>
                                  <strong>⚠️ Tool call error:</strong> {error.message}
                                  <details style={{ marginTop: 4, fontSize: 10 }}>
                                    <summary>Tool data</summary>
                                    <pre style={{ 
                                      marginTop: 4, 
                                      overflow: 'auto',
                                      whiteSpace: 'pre-wrap',
                                      wordBreak: 'break-word',
                                      overflowWrap: 'break-word',
                                      maxWidth: '100%'
                                    }}>
                                      {JSON.stringify({ toolName, input: part.input }, null, 2)}
                                    </pre>
                                  </details>
                                </div>
                              )}
                            >
                              <ToolCallDisplay 
                                toolName={toolName}
                                input={part.input}
                                fullData={part}
                              />
                            </ErrorBoundary>
                          );
                        }
                        if ("output" in part) {
                          return (
                            <ErrorBoundary 
                              key={`${m.id}-${i}`}
                              level="component"
                              fallback={(error) => (
                                <div style={{ 
                                  padding: 8, 
                                  marginBottom: 8,
                                  background: '#fef3c7',
                                  border: '1px solid #fde68a',
                                  borderRadius: 4,
                                  fontSize: 11,
                                }}>
                                  <strong>⚠️ Tool result error:</strong> {error.message}
                                </div>
                              )}
                            >
                              <ToolResultDisplay 
                                output={part.output}
                                fullData={part}
                              />
                            </ErrorBoundary>
                          );
                        }
                      }
                      return (
                        <pre key={`${m.id}-${i}`} style={{
                          overflowX: "auto",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          overflowWrap: "break-word",
                          background: "#f5f5f5",
                          padding: 8,
                          borderRadius: 4,
                          fontSize: 12,
                          marginBottom: 8,
                          maxWidth: "100%"
                        }}>
                          {JSON.stringify(part, null, 2)}
                        </pre>
                      );
                    })}
                  </div>
                </ErrorBoundary>
              ))}
            {status === "streaming" && (
              <div style={{ color: "#666", fontSize: 14, fontStyle: "italic" }}>
                AI is thinking...
              </div>
            )}
            </div>
          </ErrorBoundary>

          {error && (
            <div style={{ 
              margin: "0 16px 16px 16px",
              padding: 12, 
              background: "#ffebee", 
              border: "1px solid #ef5350",
              borderRadius: 6,
              color: "#c62828"
            }}>
              Error: {error.message}
            </div>
          )}

          <div style={{ 
            borderTop: "1px solid #ddd", 
            padding: 16,
            background: "#fafbfc",
            color: "#666"
          }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={status !== "ready" ? "AI is thinking..." : "Ask the AI to interact with the world..."}
                disabled={status !== "ready"}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (input.trim().length === 0) return;
                    sendMessage({ text: input });
                    setInput("");
                  }
                }}
                style={{ 
                  flex: 1, 
                  padding: 12,
                  border: "1px solid #ddd",
                  borderRadius: 6,
                  fontSize: 14,
                  background: "#fff",
                  color: "#222"
                }}
              />
              <button
                type="button"
                onClick={() => {
                  if (input.trim().length === 0) return;
                  sendMessage({ text: input });
                  setInput("");
                }}
                disabled={status !== "ready"}
                style={{ 
                  padding: "12px 24px",
                  background: status === "ready" ? "#1976d2" : "#ccc",
                  color: "white",
                  border: "none",
                  borderRadius: 6,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: status === "ready" ? "pointer" : "not-allowed"
                }}
              >
                Send
              </button>
            </div>
            <div style={{ 
              marginTop: 12, 
              fontSize: 12, 
              color: "#666" 
            }}>
              Try: "Can you make me some coffee?", "Where is the coffee mug?", "Pick up the keys and bring them to me", "Show me the family photo"
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

