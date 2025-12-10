import type { Vector3 } from "three";

export enum MaterialType {
  AIR = "AIR",
  DRYWALL = "DRYWALL",
  WOOD = "WOOD",
  GLASS = "GLASS",
  CONCRETE = "CONCRETE",
  METAL = "METAL",
  FLESH = "FLESH", // Placeholder for organic simulation
}

export interface MaterialProperties {
  name: string;
  density: number; // g/cm3 approximation
  hardness: number; // 0-1 factor for ricochet probability
  roughness: number; // Deflection variance
  color: string;
}

export interface BulletSegment {
  start: Vector3;
  end: Vector3;
  direction: Vector3; // Normalized direction vector for physics impulses
  type: "air" | "penetration" | "ricochet";
  energyAtStart: number;
  hitObjectUUID?: string; // ID of the object hit at the end of this segment
}

export interface BulletTrace {
  id: number;
  segments: BulletSegment[];
  timestamp: number;
}

export const GRAVITY = 9.81;
export const MUZZLE_VELOCITY = 300; // m/s (Subsonic for easier visualization)



