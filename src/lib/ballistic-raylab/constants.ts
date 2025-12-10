import { MaterialType, type MaterialProperties } from "./types";

// Approximate material properties for simulation
export const MATERIALS: Record<MaterialType, MaterialProperties> = {
  [MaterialType.AIR]: {
    name: "Air",
    density: 0.001,
    hardness: 0,
    roughness: 0,
    color: "#transparent",
  },
  [MaterialType.DRYWALL]: {
    name: "Drywall",
    density: 0.7, // g/cm3
    hardness: 0.1, // Easy to penetrate
    roughness: 0.1,
    color: "#e2e8f0",
  },
  [MaterialType.WOOD]: {
    name: "Wood (Oak)",
    density: 0.75,
    hardness: 0.3,
    roughness: 0.4, // Causes tumbling
    color: "#a0522d",
  },
  [MaterialType.GLASS]: {
    name: "Glass",
    density: 2.5,
    hardness: 0.8, // Brittle but hard
    roughness: 0.05, // Clean entry usually
    color: "#a5f3fc",
  },
  [MaterialType.CONCRETE]: {
    name: "Concrete",
    density: 2.4,
    hardness: 0.9,
    roughness: 0.8,
    color: "#64748b",
  },
  [MaterialType.METAL]: {
    name: "Steel",
    density: 7.8,
    hardness: 0.98,
    roughness: 0.1,
    color: "#475569",
  },
  [MaterialType.FLESH]: {
    name: "Gelatin",
    density: 1.0,
    hardness: 0.05,
    roughness: 0.5,
    color: "#fca5a5",
  },
};



