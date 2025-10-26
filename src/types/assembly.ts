export type SemVer = `${number}.${number}.${number}`
export type UUID = string
export type meters = number
export type kilograms = number
export type radians = number
export type watts = number

export interface Transform {
  position: [number, number, number]
  rotationQuat: [number, number, number, number]
  scale?: [number, number, number]
}

export interface LODRef {
  gltf: string
  node?: string
  screenCoverage?: number
}

export interface RenderDef {
  gltf?: string
  node?: string
  scale?: number
  icon?: string
  lod?: LODRef[]
  /** Optional simple shape helpers for prototyping without external assets */
  shape?: 'box' | 'cylinder' | 'panel'
  size?: [number, number, number]
  radius?: number
  height?: number
  color?: string
}

export interface ColliderDef {
  shape: 'box' | 'sphere' | 'capsule' | 'cylinder' | 'convexHull' | 'mesh'
  params: number[]
  offset?: Transform
  material?: {
    friction?: number
    restitution?: number
  }
}

export interface SocketDef {
  id: string
  kind: 'structural' | 'mechanical' | 'electrical' | 'fluid' | 'inventory' | 'decorative'
  type: string
  gender?: 'male' | 'female' | 'neutral'
  tags?: string[]
  frame: Transform
  allowedMates?: string[]
  defaultJoint?: string
}

export interface JointTemplateDrive {
  mode: 'velocity' | 'position' | 'spring'
  target?: number
  stiffness?: number
  damping?: number
  maxForce?: number
}

export interface JointTemplate {
  id: string
  type: 'fixed' | 'revolute' | 'prismatic' | 'spherical' | 'd6'
  axis?: [number, number, number]
  limits?: { axis?: 'x' | 'y' | 'z'; lower: number; upper: number }[]
  drive?: JointTemplateDrive[]
  friction?: number
  breakable?: { force: number; torque: number }
}

export interface MateRule {
  fromType: string
  toType: string
  joint: string
  alignment?: 'coincident' | 'coaxial' | 'planar'
}

export interface PowerPortDef {
  id: string
  role: 'source' | 'sink' | 'both'
  voltage?: number
  maxCurrent?: number
  connector: string
  frame: Transform
}

export interface SignalPortDef {
  id: string
  channels: Record<string, 'digital' | 'analog'>
  frame: Transform
}

export interface FluidPortDef {
  id: string
  medium: 'air' | 'water' | 'fuel' | 'oil'
  maxFlow?: number
  frame: Transform
}

export interface ConveyorPortDef {
  id: string
  size: 'small' | 'medium' | 'large'
  direction: 'in' | 'out' | 'both'
  frame: Transform
}

export type ComponentDef = MotorDef | WheelDef | SuspensionDef | BatteryDef | ControllerDef | LightDef

export interface MotorDef {
  kind: 'Motor'
  axis: 'x' | 'y' | 'z' | 'custom'
  drivesSocket?: string
  nominalPower: watts
  maxTorque: number
  maxRPM: number
  efficiency?: number
}

export interface WheelDef {
  kind: 'Wheel'
  radius: meters
  width: meters
  usesRaycast?: boolean
}

export interface SuspensionDef {
  kind: 'Suspension'
  travel: meters
  stiffness: number
  damping: number
}

export interface BatteryDef {
  kind: 'Battery'
  capacityWh: number
  maxDischargeW: watts
  maxChargeW?: watts
}

export interface ControllerDef {
  kind: 'Controller'
  script?: string
  inputs?: string[]
  outputs?: string[]
}

export interface LightDef {
  kind: 'Light'
  lumens: number
  powerDraw: watts
}

export interface ParamDef {
  id: string
  type: 'float' | 'int' | 'bool' | 'enum' | 'vec3' | 'color'
  default: any
  min?: number
  max?: number
  step?: number
  description?: string
}

export interface MaterialDef {
  id: string
  density?: number
  friction?: number
  restitution?: number
  pbr?: any
}

export interface Meta {
  author?: string
  license?: string
  tags?: string[]
  cost?: number
  description?: string
}

export interface PartDef {
  id: string
  version: SemVer
  name: string
  category: 'structural' | 'mechanical' | 'electrical' | 'fluid' | 'decor' | 'logic'
  render?: RenderDef
  physics?: {
    dynamic: boolean
    mass?: kilograms
    inertiaTensor?: number[]
    colliders?: ColliderDef[]
  }
  sockets: SocketDef[]
  ports?: {
    power?: PowerPortDef[]
    signal?: SignalPortDef[]
    fluid?: FluidPortDef[]
    inventory?: ConveyorPortDef[]
  }
  components?: ComponentDef[]
  params?: ParamDef[]
  metadata?: Meta
}

export interface PrefabDef {
  id: string
  version: SemVer
  name: string
  assembly: Assembly
  params?: ParamDef[]
}

export interface Catalog {
  id: string
  version: SemVer
  parts: Record<string, PartDef>
  prefabs?: Record<string, PrefabDef>
  materials?: Record<string, MaterialDef>
  jointTemplates?: Record<string, JointTemplate>
  rules?: MateRule[]
}

export interface PartInstance {
  id: UUID
  partId: string
  partVersion?: SemVer
  transform: Transform
  paramOverrides?: Record<string, any>
  materialOverrides?: Record<string, any>
  label?: string
}

export interface InstanceSocketRef {
  partInstanceId: UUID
  socketId: string
}

export interface JointDriveOverride {
  mode?: 'velocity' | 'position' | 'spring'
  target?: number
  maxForce?: number
}

export interface JointInstance {
  id: UUID
  a: InstanceSocketRef
  b: InstanceSocketRef
  template: string
  anchorAOverride?: Transform
  anchorBOverride?: Transform
  limitsOverride?: any
  driveOverride?: JointDriveOverride
  articulationGroup?: string
  label?: string
}

export interface NetworkConnection {
  id: UUID
  kind: 'power' | 'signal' | 'fluid' | 'inventory'
  from: InstancePortRef
  to: InstancePortRef
  properties?: Record<string, any>
}

export interface InstancePortRef {
  partInstanceId: UUID
  portId: string
}

export interface Group {
  id: UUID
  name?: string
  partIds: UUID[]
}

export interface Assembly {
  id: UUID
  name?: string
  parts: PartInstance[]
  joints: JointInstance[]
  networks?: NetworkConnection[]
  groups?: Group[]
  bakePolicy?: 'articulated' | 'compound' | 'grid-merge'
}

export interface Blueprint {
  id: UUID
  name: string
  version: SemVer
  root: Assembly
}

export interface RuntimeState {
  parts: Record<UUID, PartRuntime>
  joints: Record<UUID, JointRuntime>
  networks: Record<UUID, NetworkRuntime>
  telemetry?: any
}

export interface PartRuntime {
  health: number
  temperature?: number
  powered?: boolean
  powerInW?: number
  powerOutW?: number
  dynamic?: {
    velocity: [number, number, number]
    omega: [number, number, number]
    asleep: boolean
  }
  sensors?: Record<string, number>
}

export interface JointRuntime {
  angle?: number
  position?: number
  motor?: { enabled: boolean; target?: number; current?: number }
  broken?: boolean
}

export interface NetworkRuntime {
  power?: { voltage: number; current: number }
  signal?: Record<string, number>
  fluid?: { flow: number; pressure: number }
  inventory?: { rate: number; capacity: number }
}

export interface Inventory {
  parts: string[]
  prefabs: string[]
  quantities?: Record<string, number>
  favorites?: string[]
  lastUsed?: string[]
}

export interface Pack {
  id: string
  version: SemVer
  name: string
  parts: PartDef[]
  prefabs?: PrefabDef[]
  materials?: MaterialDef[]
  dependencies?: string[]
  signature?: string
}
