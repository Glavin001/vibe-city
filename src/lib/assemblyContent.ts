import type { Blueprint, Catalog, PartInstance, PartDef, JointInstance } from '../types/assembly'
import { IDENTITY_QUAT } from './assemblyMath'

type BlueprintExample = {
  id: string
  title: string
  summary: string
  blueprint: Blueprint
}

const SQRT_HALF = Math.SQRT1_2
const QUAT_Y90: [number, number, number, number] = [0, SQRT_HALF, 0, SQRT_HALF]
const QUAT_NEG_Y90: [number, number, number, number] = [0, -SQRT_HALF, 0, SQRT_HALF]

const buildingParts: Record<string, PartDef> = {
  'core:floor_panel_v1': {
    id: 'core:floor_panel_v1',
    version: '1.0.0',
    name: 'Floor Panel 4m',
    category: 'structural',
    render: { shape: 'box', size: [4, 0.2, 4], color: '#78736b' },
    physics: {
      dynamic: false,
      colliders: [{ shape: 'box', params: [2, 0.1, 2] }],
    },
    sockets: [
      {
        id: 'north_edge',
        kind: 'structural',
        type: 'grid:4m',
        frame: { position: [0, 0.1, 2], rotationQuat: IDENTITY_QUAT },
        allowedMates: ['grid:4m'],
      },
      {
        id: 'south_edge',
        kind: 'structural',
        type: 'grid:4m',
        frame: { position: [0, 0.1, -2], rotationQuat: IDENTITY_QUAT },
        allowedMates: ['grid:4m'],
      },
      {
        id: 'east_edge',
        kind: 'structural',
        type: 'grid:4m',
        frame: { position: [2, 0.1, 0], rotationQuat: QUAT_Y90 },
        allowedMates: ['grid:4m'],
      },
      {
        id: 'west_edge',
        kind: 'structural',
        type: 'grid:4m',
        frame: { position: [-2, 0.1, 0], rotationQuat: QUAT_NEG_Y90 },
        allowedMates: ['grid:4m'],
      },
      {
        id: 'roof_mount',
        kind: 'structural',
        type: 'roof:plate',
        frame: { position: [0, 0.1, 0], rotationQuat: IDENTITY_QUAT },
      },
    ],
    metadata: {
      tags: ['building', 'structural'],
      description: '4x4m reinforced foundation slab',
    },
  },
  'core:wall_panel_v1': {
    id: 'core:wall_panel_v1',
    version: '1.0.0',
    name: 'Wall Panel',
    category: 'structural',
    render: { shape: 'box', size: [4, 2.5, 0.2], color: '#bcb6aa' },
    physics: {
      dynamic: false,
      colliders: [{ shape: 'box', params: [2, 1.25, 0.1] }],
    },
    sockets: [
      {
        id: 'bottom_edge',
        kind: 'structural',
        type: 'grid:4m',
        frame: { position: [0, -1.25, 0], rotationQuat: IDENTITY_QUAT },
        allowedMates: ['grid:4m'],
      },
      {
        id: 'top_edge',
        kind: 'structural',
        type: 'roof:plate',
        frame: { position: [0, 1.25, 0], rotationQuat: IDENTITY_QUAT },
      },
    ],
    metadata: {
      tags: ['building', 'wall'],
    },
  },
  'core:wall_panel_door_v1': {
    id: 'core:wall_panel_door_v1',
    version: '1.0.0',
    name: 'Wall Panel with Door Frame',
    category: 'structural',
    render: { shape: 'box', size: [4, 2.5, 0.2], color: '#c6c0b0' },
    physics: {
      dynamic: false,
      colliders: [{ shape: 'box', params: [2, 1.25, 0.1] }],
    },
    sockets: [
      {
        id: 'bottom_edge',
        kind: 'structural',
        type: 'grid:4m',
        frame: { position: [0, -1.25, 0], rotationQuat: IDENTITY_QUAT },
        allowedMates: ['grid:4m'],
      },
      {
        id: 'door_hinge',
        kind: 'mechanical',
        type: 'hinge:standard',
        frame: { position: [-0.5, 0, -0.025], rotationQuat: IDENTITY_QUAT },
        defaultJoint: 'hinge_door_v1',
      },
      {
        id: 'top_edge',
        kind: 'structural',
        type: 'roof:plate',
        frame: { position: [0, 1.25, 0], rotationQuat: IDENTITY_QUAT },
      },
    ],
    metadata: {
      tags: ['building', 'wall', 'door'],
    },
  },
  'core:roof_panel_v1': {
    id: 'core:roof_panel_v1',
    version: '1.0.0',
    name: 'Roof Panel',
    category: 'structural',
    render: { shape: 'box', size: [4.2, 0.2, 4.2], color: '#4f5358' },
    physics: {
      dynamic: false,
      colliders: [{ shape: 'box', params: [2.1, 0.1, 2.1] }],
    },
    sockets: [
      {
        id: 'underside_center',
        kind: 'structural',
        type: 'roof:plate',
        frame: { position: [0, -0.1, 0], rotationQuat: IDENTITY_QUAT },
      },
    ],
    metadata: {
      tags: ['building', 'roof'],
    },
  },
  'core:door_panel_v1': {
    id: 'core:door_panel_v1',
    version: '1.0.0',
    name: 'Wooden Door',
    category: 'structural',
    render: { shape: 'box', size: [1, 2.2, 0.05], color: '#8b5a3c' },
    physics: {
      dynamic: true,
      mass: 18,
      colliders: [{ shape: 'box', params: [0.5, 1.1, 0.025] }],
    },
    sockets: [
      {
        id: 'hinge',
        kind: 'mechanical',
        type: 'hinge:standard',
        frame: { position: [0.5, 0, 0], rotationQuat: IDENTITY_QUAT },
        allowedMates: ['hinge:standard'],
      },
    ],
    metadata: {
      tags: ['door', 'dynamic'],
    },
  },
}

const vehicleParts: Record<string, PartDef> = {
  'veh:chassis_small_v1': {
    id: 'veh:chassis_small_v1',
    version: '1.0.0',
    name: 'Compact Chassis',
    category: 'mechanical',
    render: { shape: 'box', size: [2.6, 0.4, 1.6], color: '#2b4255' },
    physics: {
      dynamic: true,
      mass: 240,
      colliders: [{ shape: 'box', params: [1.3, 0.2, 0.8] }],
    },
    sockets: [
      {
        id: 'front_left_axle',
        kind: 'mechanical',
        type: 'axle:wheel90',
        frame: { position: [-1.0, -0.25, 1.2], rotationQuat: IDENTITY_QUAT },
        defaultJoint: 'hinge_wheel_motor_v1',
      },
      {
        id: 'front_right_axle',
        kind: 'mechanical',
        type: 'axle:wheel90',
        frame: { position: [1.0, -0.25, 1.2], rotationQuat: IDENTITY_QUAT },
        defaultJoint: 'hinge_wheel_motor_v1',
      },
      {
        id: 'rear_left_axle',
        kind: 'mechanical',
        type: 'axle:wheel90',
        frame: { position: [-1.0, -0.25, -1.2], rotationQuat: IDENTITY_QUAT },
        defaultJoint: 'hinge_wheel_motor_v1',
      },
      {
        id: 'rear_right_axle',
        kind: 'mechanical',
        type: 'axle:wheel90',
        frame: { position: [1.0, -0.25, -1.2], rotationQuat: IDENTITY_QUAT },
        defaultJoint: 'hinge_wheel_motor_v1',
      },
      {
        id: 'roof_rack',
        kind: 'structural',
        type: 'grid:1m',
        frame: { position: [0, 0.2, 0], rotationQuat: IDENTITY_QUAT },
      },
    ],
    metadata: {
      tags: ['vehicle', 'dynamic'],
    },
  },
  'veh:wheel_90cm_v1': {
    id: 'veh:wheel_90cm_v1',
    version: '1.0.0',
    name: '90cm Traction Wheel',
    category: 'mechanical',
    render: { shape: 'cylinder', radius: 0.45, height: 0.3, color: '#222222' },
    physics: {
      dynamic: true,
      mass: 32,
      colliders: [
        { shape: 'cylinder', params: [0.45, 0.15], offset: { position: [0, 0, 0], rotationQuat: [0, 0, 0.7071068, 0.7071068] } },
      ],
    },
    sockets: [
      {
        id: 'axle',
        kind: 'mechanical',
        type: 'axle:wheel90',
        frame: { position: [0, 0, 0], rotationQuat: IDENTITY_QUAT },
        allowedMates: ['axle:wheel90'],
      },
    ],
    components: [
      { kind: 'Wheel', radius: 0.45, width: 0.3 },
      { kind: 'Motor', axis: 'x', nominalPower: 2500, maxTorque: 280, maxRPM: 600 },
    ],
    metadata: {
      tags: ['vehicle', 'wheel', 'motor'],
    },
  },
}

const catalog: Catalog = {
  id: 'demo:assembly-catalog',
  version: '0.1.0',
  parts: {
    ...buildingParts,
    ...vehicleParts,
  },
  jointTemplates: {
    fixed_weld_v1: {
      id: 'fixed_weld_v1',
      type: 'fixed',
      friction: 1,
    },
    hinge_door_v1: {
      id: 'hinge_door_v1',
      type: 'revolute',
      axis: [0, 1, 0],
      friction: 2,
    },
    hinge_wheel_motor_v1: {
      id: 'hinge_wheel_motor_v1',
      type: 'revolute',
      axis: [1, 0, 0],
      friction: 0.2,
      drive: [
        { mode: 'velocity', target: 0, maxForce: 1200 },
      ],
    },
  },
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value))

const houseParts: PartInstance[] = [
  {
    id: 'pi_floor',
    partId: 'core:floor_panel_v1',
    transform: { position: [0, 0, 0], rotationQuat: IDENTITY_QUAT },
    label: 'Floor Slab',
  },
  {
    id: 'pi_wall_north',
    partId: 'core:wall_panel_door_v1',
    transform: { position: [0, 1.25, 2], rotationQuat: IDENTITY_QUAT },
    label: 'North Wall',
  },
  {
    id: 'pi_wall_south',
    partId: 'core:wall_panel_v1',
    transform: { position: [0, 1.25, -2], rotationQuat: IDENTITY_QUAT },
    label: 'South Wall',
  },
  {
    id: 'pi_wall_east',
    partId: 'core:wall_panel_v1',
    transform: { position: [2, 1.25, 0], rotationQuat: QUAT_Y90 },
    label: 'East Wall',
  },
  {
    id: 'pi_wall_west',
    partId: 'core:wall_panel_v1',
    transform: { position: [-2, 1.25, 0], rotationQuat: QUAT_Y90 },
    label: 'West Wall',
  },
  {
    id: 'pi_roof',
    partId: 'core:roof_panel_v1',
    transform: { position: [0, 2.6, 0], rotationQuat: IDENTITY_QUAT },
    label: 'Roof',
  },
  {
    id: 'pi_door',
    partId: 'core:door_panel_v1',
    transform: { position: [-1, 1.1, 1.975], rotationQuat: IDENTITY_QUAT },
    label: 'Door',
  },
]

const houseJoints: JointInstance[] = [
  {
    id: 'joint_floor_north',
    a: { partInstanceId: 'pi_floor', socketId: 'north_edge' },
    b: { partInstanceId: 'pi_wall_north', socketId: 'bottom_edge' },
    template: 'fixed_weld_v1',
  },
  {
    id: 'joint_floor_south',
    a: { partInstanceId: 'pi_floor', socketId: 'south_edge' },
    b: { partInstanceId: 'pi_wall_south', socketId: 'bottom_edge' },
    template: 'fixed_weld_v1',
  },
  {
    id: 'joint_floor_east',
    a: { partInstanceId: 'pi_floor', socketId: 'east_edge' },
    b: { partInstanceId: 'pi_wall_east', socketId: 'bottom_edge' },
    template: 'fixed_weld_v1',
  },
  {
    id: 'joint_floor_west',
    a: { partInstanceId: 'pi_floor', socketId: 'west_edge' },
    b: { partInstanceId: 'pi_wall_west', socketId: 'bottom_edge' },
    template: 'fixed_weld_v1',
  },
  {
    id: 'joint_roof',
    a: { partInstanceId: 'pi_roof', socketId: 'underside_center' },
    b: { partInstanceId: 'pi_floor', socketId: 'roof_mount' },
    template: 'fixed_weld_v1',
  },
  {
    id: 'joint_door',
    a: { partInstanceId: 'pi_wall_north', socketId: 'door_hinge' },
    b: { partInstanceId: 'pi_door', socketId: 'hinge' },
    template: 'hinge_door_v1',
    driveOverride: { mode: 'velocity', target: 0, maxForce: 60 },
  },
]

const houseBlueprint: Blueprint = {
  id: 'bp:demo_house_v1',
  name: 'Hinged House',
  version: '0.1.0',
  root: {
    id: 'asm:house_root',
    name: 'House Assembly',
    parts: houseParts,
    joints: houseJoints,
    bakePolicy: 'articulated',
  },
}

const carParts: PartInstance[] = [
  {
    id: 'pi_car_ground',
    partId: 'core:floor_panel_v1',
    transform: { position: [0, -0.1, 0], rotationQuat: IDENTITY_QUAT },
    label: 'Service Pad',
  },
  {
    id: 'pi_chassis',
    partId: 'veh:chassis_small_v1',
    transform: { position: [0, 0.6, 0], rotationQuat: IDENTITY_QUAT },
    label: 'Chassis',
  },
  {
    id: 'pi_wheel_fl',
    partId: 'veh:wheel_90cm_v1',
    transform: { position: [-1.0, 0.35, 1.2], rotationQuat: IDENTITY_QUAT },
    label: 'Front Left Wheel',
  },
  {
    id: 'pi_wheel_fr',
    partId: 'veh:wheel_90cm_v1',
    transform: { position: [1.0, 0.35, 1.2], rotationQuat: IDENTITY_QUAT },
    label: 'Front Right Wheel',
  },
  {
    id: 'pi_wheel_rl',
    partId: 'veh:wheel_90cm_v1',
    transform: { position: [-1.0, 0.35, -1.2], rotationQuat: IDENTITY_QUAT },
    label: 'Rear Left Wheel',
  },
  {
    id: 'pi_wheel_rr',
    partId: 'veh:wheel_90cm_v1',
    transform: { position: [1.0, 0.35, -1.2], rotationQuat: IDENTITY_QUAT },
    label: 'Rear Right Wheel',
  },
]

const motorDrive = { mode: 'velocity' as const, target: 0, maxForce: 800 }

const carJoints: JointInstance[] = [
  {
    id: 'joint_fl',
    a: { partInstanceId: 'pi_chassis', socketId: 'front_left_axle' },
    b: { partInstanceId: 'pi_wheel_fl', socketId: 'axle' },
    template: 'hinge_wheel_motor_v1',
    driveOverride: motorDrive,
    articulationGroup: 'car_drivetrain',
  },
  {
    id: 'joint_fr',
    a: { partInstanceId: 'pi_chassis', socketId: 'front_right_axle' },
    b: { partInstanceId: 'pi_wheel_fr', socketId: 'axle' },
    template: 'hinge_wheel_motor_v1',
    driveOverride: motorDrive,
    articulationGroup: 'car_drivetrain',
  },
  {
    id: 'joint_rl',
    a: { partInstanceId: 'pi_chassis', socketId: 'rear_left_axle' },
    b: { partInstanceId: 'pi_wheel_rl', socketId: 'axle' },
    template: 'hinge_wheel_motor_v1',
    driveOverride: motorDrive,
    articulationGroup: 'car_drivetrain',
  },
  {
    id: 'joint_rr',
    a: { partInstanceId: 'pi_chassis', socketId: 'rear_right_axle' },
    b: { partInstanceId: 'pi_wheel_rr', socketId: 'axle' },
    template: 'hinge_wheel_motor_v1',
    driveOverride: motorDrive,
    articulationGroup: 'car_drivetrain',
  },
]

const carBlueprint: Blueprint = {
  id: 'bp:demo_car_v1',
  name: 'Motorized Rover',
  version: '0.1.0',
  root: {
    id: 'asm:car_root',
    name: 'Rover Assembly',
    parts: carParts,
    joints: carJoints,
    bakePolicy: 'articulated',
  },
}

export const assemblyCatalog = catalog

export const blueprintExamples: BlueprintExample[] = [
  {
    id: 'example-house',
    title: 'Hinged House',
    summary: 'Structural assembly with a hinged door. Rotate the door or move wall panels to explore sockets.',
    blueprint: houseBlueprint,
  },
  {
    id: 'example-car',
    title: 'Simple Motorized Rover',
    summary: 'Four-wheel articulated rover powered by rapier motorized hinge joints. Drive with WASD keys.',
    blueprint: carBlueprint,
  },
]

export const getBlueprintPreset = (exampleId: string): Blueprint => {
  const example = blueprintExamples.find((candidate) => candidate.id === exampleId)
  if (!example) {
    throw new Error(`Unknown blueprint preset ${exampleId}`)
  }
  return clone(example.blueprint)
}

export const listBlueprintOptions = () =>
  blueprintExamples.map((example) => ({ id: example.id, title: example.title, summary: example.summary }))
