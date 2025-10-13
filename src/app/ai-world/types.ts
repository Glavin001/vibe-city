export type Vec3 = [number, number, number]

export interface AgentPose {
  position: Vec3
  yaw: number
  pitch: number
}

export type Controls = 'forward' | 'backward' | 'left' | 'right' | 'jump' | 'run'

export const CONTROLS_MAP: { name: Controls; keys: string[] }[] = [
  { name: 'forward', keys: ['ArrowUp', 'w', 'W'] },
  { name: 'backward', keys: ['ArrowDown', 's', 'S'] },
  { name: 'left', keys: ['ArrowLeft', 'a', 'A'] },
  { name: 'right', keys: ['ArrowRight', 'd', 'D'] },
  { name: 'jump', keys: ['Space'] },
  { name: 'run', keys: ['Shift'] },
]

export const LOCAL_STORAGE_KEY = "GOOGLE_API_KEY"

