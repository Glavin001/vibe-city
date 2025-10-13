/**
 * Configuration for the AI World
 * Centralized settings for easy tweaking
 */

export const WORLD_CONFIG = {
  // Physics settings
  physics: {
    gravity: [0, -20, 0] as [number, number, number],
    playerMass: 1.0,
    npcMass: 1.0,
  },

  // Player settings
  player: {
    speed: 2.0,
    eyeHeight: 0.6,
    startPosition: [0, 1, 0] as [number, number, number],
    mouseSensitivity: 0.002,
    inventorySlots: 20,
    inventoryWeight: 50,
  },

  // NPC settings
  npcs: {
    updateInterval: 100, // ms
    defaultSpeed: 1.6,
    inventorySlots: 12,
    inventoryWeight: 30,
  },

  // World update intervals
  updates: {
    playerPoseUpdate: 100, // ms
    physicsUpdate: 50, // ms
    cameraUpdate: 16, // ms (~60fps)
  },

  // UI settings
  ui: {
    actionLogMaxItems: 10,
    chatHistoryMaxItems: 50,
  },

  // Buildings configuration
  buildings: [
    {
      name: "Kitchen",
      position: [-5, 2, -6] as [number, number, number],
      size: [6, 4, 6] as [number, number, number],
      color: "#1e3a5f",
    },
    {
      name: "Workshop",
      position: [5, 2, 5] as [number, number, number],
      size: [5, 4, 5] as [number, number, number],
      color: "#4a5568",
    },
    {
      name: "Storage",
      position: [0, 2, -15] as [number, number, number],
      size: [8, 4, 4] as [number, number, number],
      color: "#2d5016",
    },
  ],

  // AI Model settings
  ai: {
    model: "gemini-2.0-flash-exp",
    temperature: 0.7,
    maxTokens: 2048,
  },
} as const

export const CAMERA_CONFIG = {
  fov: 75,
  near: 0.1,
  far: 1000,
}

export const GRID_CONFIG = {
  size: 60,
  divisions: 60,
  colorCenterLine: '#4b5563',
  colorGrid: '#374151',
}

