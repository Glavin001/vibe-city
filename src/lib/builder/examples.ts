import type { Blueprint, Catalog, Transform } from "./model";
import { DEG2RAD, eulerToQuaternion } from "./math";
import { cloneBlueprint } from "./utils";

function rotationFromEulerDegrees(
  x: number,
  y: number,
  z: number,
): Transform["rotationQuat"] {
  return eulerToQuaternion([x * DEG2RAD, y * DEG2RAD, z * DEG2RAD]);
}

function transform(
  position: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
): Transform {
  return {
    position,
    rotationQuat: rotationFromEulerDegrees(rotation[0], rotation[1], rotation[2]),
  };
}

const identityQuat: Transform["rotationQuat"] = [0, 0, 0, 1];

export const builderCatalog: Catalog = {
  id: "core:builder_demo",
  version: "0.1.0",
  parts: {
    "core:ground_plate_v1": {
      id: "core:ground_plate_v1",
      version: "1.0.0",
      name: "Ground Plate 10m",
      category: "structural",
      physics: {
        dynamic: false,
        colliders: [
          {
            shape: "box",
            params: [5, 0.1, 5],
            material: { friction: 1 },
          },
        ],
      },
      sockets: [],
      metadata: {
        tags: ["ground", "foundation"],
        color: "#4b5563",
        dimensions: [10, 0.2, 10],
      },
    },
    "core:floor_panel_v1": {
      id: "core:floor_panel_v1",
      version: "1.0.0",
      name: "Floor Panel 4m",
      category: "structural",
      physics: {
        dynamic: false,
        colliders: [
          {
            shape: "box",
            params: [2, 0.1, 2],
            material: { friction: 1 },
          },
        ],
      },
      sockets: [],
      metadata: {
        tags: ["building", "floor"],
        color: "#9ca3af",
        dimensions: [4, 0.2, 4],
      },
    },
    "core:wall_panel_v1": {
      id: "core:wall_panel_v1",
      version: "1.0.0",
      name: "Wall Panel 4m",
      category: "structural",
      physics: {
        dynamic: false,
        colliders: [
          {
            shape: "box",
            params: [2, 1.25, 0.1],
            material: { friction: 1 },
          },
        ],
      },
      sockets: [
        {
          id: "edge_left",
          kind: "structural",
          type: "grid:4m",
          frame: transform([-2, 0, 0]),
        },
        {
          id: "edge_right",
          kind: "structural",
          type: "grid:4m",
          frame: transform([2, 0, 0]),
        },
        {
          id: "door_mount_left",
          kind: "mechanical",
          type: "hinge:door",
          tags: ["door", "mount"],
          frame: {
            position: [-1.5, -0.25, 0],
            rotationQuat: identityQuat,
          },
          allowedMates: ["hinge:door"],
          defaultJoint: "core:door_hinge",
        },
      ],
      metadata: {
        tags: ["building", "wall"],
        color: "#cbd5f5",
        dimensions: [4, 2.5, 0.2],
      },
    },
    "core:roof_flat_v1": {
      id: "core:roof_flat_v1",
      version: "1.0.0",
      name: "Roof Panel 4m",
      category: "structural",
      physics: {
        dynamic: false,
        colliders: [
          {
            shape: "box",
            params: [2.2, 0.1, 2.2],
            material: { friction: 0.6 },
          },
        ],
      },
      sockets: [],
      metadata: {
        tags: ["building", "roof"],
        color: "#dc2626",
        dimensions: [4.4, 0.2, 4.4],
      },
    },
    "core:door_single_v1": {
      id: "core:door_single_v1",
      version: "1.0.0",
      name: "Door (Left Hinge)",
      category: "structural",
      physics: {
        dynamic: true,
        mass: 25,
        colliders: [
          {
            shape: "box",
            params: [0.5, 1, 0.05],
            material: { friction: 0.8 },
          },
        ],
      },
      sockets: [
        {
          id: "hinge",
          kind: "mechanical",
          type: "hinge:door",
          frame: {
            position: [-0.5, 0, 0],
            rotationQuat: identityQuat,
          },
          allowedMates: ["hinge:door"],
          defaultJoint: "core:door_hinge",
        },
      ],
      metadata: {
        tags: ["door"],
        color: "#92400e",
        dimensions: [1, 2, 0.1],
      },
    },
    "veh:chassis_light_v1": {
      id: "veh:chassis_light_v1",
      version: "1.0.0",
      name: "Light Chassis",
      category: "mechanical",
      physics: {
        dynamic: true,
        mass: 120,
        colliders: [
          {
            shape: "box",
            params: [0.7, 0.2, 1.2],
            material: { friction: 0.8 },
          },
        ],
      },
      sockets: [
        {
          id: "wheel_fl",
          kind: "mechanical",
          type: "axle:drive",
          tags: ["wheel", "front", "left"],
          frame: {
            position: [-0.9, -0.25, 1.1],
            rotationQuat: rotationFromEulerDegrees(0, 0, 90),
          },
          allowedMates: ["axle:drive"],
          defaultJoint: "veh:wheel_axle",
        },
        {
          id: "wheel_fr",
          kind: "mechanical",
          type: "axle:drive",
          tags: ["wheel", "front", "right"],
          frame: {
            position: [0.9, -0.25, 1.1],
            rotationQuat: rotationFromEulerDegrees(0, 0, 90),
          },
          allowedMates: ["axle:drive"],
          defaultJoint: "veh:wheel_axle",
        },
        {
          id: "wheel_rl",
          kind: "mechanical",
          type: "axle:drive",
          tags: ["wheel", "rear", "left"],
          frame: {
            position: [-0.9, -0.25, -1.1],
            rotationQuat: rotationFromEulerDegrees(0, 0, 90),
          },
          allowedMates: ["axle:drive"],
          defaultJoint: "veh:wheel_axle",
        },
        {
          id: "wheel_rr",
          kind: "mechanical",
          type: "axle:drive",
          tags: ["wheel", "rear", "right"],
          frame: {
            position: [0.9, -0.25, -1.1],
            rotationQuat: rotationFromEulerDegrees(0, 0, 90),
          },
          allowedMates: ["axle:drive"],
          defaultJoint: "veh:wheel_axle",
        },
      ],
      metadata: {
        tags: ["vehicle", "chassis"],
        color: "#111827",
        dimensions: [1.4, 0.4, 2.4],
      },
    },
    "veh:wheel_drive_v1": {
      id: "veh:wheel_drive_v1",
      version: "1.0.0",
      name: "Drive Wheel",
      category: "mechanical",
      physics: {
        dynamic: true,
        mass: 12,
        colliders: [
          {
            shape: "cylinder",
            params: [0.35, 0.12],
            offset: {
              position: [0, 0, 0],
              rotationQuat: rotationFromEulerDegrees(0, 0, 90),
            },
            material: { friction: 1.5 },
          },
        ],
      },
      sockets: [
        {
          id: "axle",
          kind: "mechanical",
          type: "axle:drive",
          tags: ["wheel"],
          frame: {
            position: [0, 0, 0],
            rotationQuat: rotationFromEulerDegrees(0, 0, 90),
          },
          allowedMates: ["axle:drive"],
          defaultJoint: "veh:wheel_axle",
        },
      ],
      metadata: {
        tags: ["vehicle", "wheel"],
        color: "#111111",
        dimensions: [0.7, 0.24, 0.7],
      },
      components: [
        { kind: "Wheel", radius: 0.35, width: 0.24 },
        {
          kind: "Motor",
          axis: "x",
          nominalPower: 2500,
          maxTorque: 320,
          maxRPM: 1200,
        },
      ],
    },
  },
  jointTemplates: {
    "core:fixed_weld": {
      id: "core:fixed_weld",
      type: "fixed",
      friction: 1,
    },
    "core:door_hinge": {
      id: "core:door_hinge",
      type: "revolute",
      axis: [0, 1, 0],
      limits: { lower: 0, upper: Math.PI * 0.9 },
      drive: {
        mode: "position",
        target: 0,
        stiffness: 40,
        damping: 6,
        maxForce: 120,
      },
      friction: 1.2,
    },
    "veh:wheel_axle": {
      id: "veh:wheel_axle",
      type: "revolute",
      axis: [1, 0, 0],
      drive: {
        mode: "velocity",
        target: 0,
        maxForce: 450,
        damping: 1,
      },
      friction: 0.2,
    },
  },
  materials: {},
};

export const houseBlueprint: Blueprint = {
  id: "bp:demo_house",
  version: "0.1.0",
  name: "Demo House",
  root: {
    id: "asm:house_root",
    name: "House",
    bakePolicy: "articulated",
    metadata: {
      kind: "structure",
    },
    parts: [
      {
        id: "house_ground",
        partId: "core:ground_plate_v1",
        transform: transform([0, -0.1, 0]),
        label: "Ground",
      },
      {
        id: "house_floor",
        partId: "core:floor_panel_v1",
        transform: transform([0, 0.1, 0]),
        label: "Floor",
      },
      {
        id: "house_wall_front",
        partId: "core:wall_panel_v1",
        transform: transform([0, 1.35, 1.9]),
        label: "Front Wall",
      },
      {
        id: "house_wall_back",
        partId: "core:wall_panel_v1",
        transform: transform([0, 1.35, -1.9], [0, 180, 0]),
        label: "Back Wall",
      },
      {
        id: "house_wall_left",
        partId: "core:wall_panel_v1",
        transform: transform([-1.9, 1.35, 0], [0, 90, 0]),
        label: "Left Wall",
      },
      {
        id: "house_wall_right",
        partId: "core:wall_panel_v1",
        transform: transform([1.9, 1.35, 0], [0, -90, 0]),
        label: "Right Wall",
      },
      {
        id: "house_roof",
        partId: "core:roof_flat_v1",
        transform: transform([0, 2.7, 0]),
        label: "Roof",
      },
      {
        id: "house_door",
        partId: "core:door_single_v1",
        transform: transform([-1.5, 1, 1.9]),
        label: "Door",
      },
    ],
    joints: [
      {
        id: "house_door_hinge",
        a: { partInstanceId: "house_wall_front", socketId: "door_mount_left" },
        b: { partInstanceId: "house_door", socketId: "hinge" },
        template: "core:door_hinge",
        limitsOverride: { lower: 0, upper: Math.PI * 0.85 },
        tags: ["door", "hinge"],
      },
    ],
  },
};

export const carBlueprint: Blueprint = {
  id: "bp:demo_car",
  version: "0.1.0",
  name: "Demo Rover",
  root: {
    id: "asm:car_root",
    name: "Vehicle",
    bakePolicy: "articulated",
    metadata: {
      kind: "vehicle",
      controllers: ["drive"],
    },
    parts: [
      {
        id: "car_ground",
        partId: "core:ground_plate_v1",
        transform: transform([0, -0.1, 0]),
        label: "Ground",
      },
      {
        id: "car_chassis",
        partId: "veh:chassis_light_v1",
        transform: transform([0, 0.65, 0]),
        label: "Chassis",
      },
      {
        id: "car_wheel_fl",
        partId: "veh:wheel_drive_v1",
        transform: transform([-0.9, 0.35, 1.1]),
        label: "Wheel FL",
      },
      {
        id: "car_wheel_fr",
        partId: "veh:wheel_drive_v1",
        transform: transform([0.9, 0.35, 1.1]),
        label: "Wheel FR",
      },
      {
        id: "car_wheel_rl",
        partId: "veh:wheel_drive_v1",
        transform: transform([-0.9, 0.35, -1.1]),
        label: "Wheel RL",
      },
      {
        id: "car_wheel_rr",
        partId: "veh:wheel_drive_v1",
        transform: transform([0.9, 0.35, -1.1]),
        label: "Wheel RR",
      },
    ],
    joints: [
      {
        id: "car_joint_fl",
        a: { partInstanceId: "car_chassis", socketId: "wheel_fl" },
        b: { partInstanceId: "car_wheel_fl", socketId: "axle" },
        template: "veh:wheel_axle",
        tags: ["wheel", "drive", "left", "front"],
      },
      {
        id: "car_joint_fr",
        a: { partInstanceId: "car_chassis", socketId: "wheel_fr" },
        b: { partInstanceId: "car_wheel_fr", socketId: "axle" },
        template: "veh:wheel_axle",
        tags: ["wheel", "drive", "right", "front"],
      },
      {
        id: "car_joint_rl",
        a: { partInstanceId: "car_chassis", socketId: "wheel_rl" },
        b: { partInstanceId: "car_wheel_rl", socketId: "axle" },
        template: "veh:wheel_axle",
        tags: ["wheel", "drive", "left", "rear"],
      },
      {
        id: "car_joint_rr",
        a: { partInstanceId: "car_chassis", socketId: "wheel_rr" },
        b: { partInstanceId: "car_wheel_rr", socketId: "axle" },
        template: "veh:wheel_axle",
        tags: ["wheel", "drive", "right", "rear"],
      },
    ],
  },
};

export const editorExamples = {
  house: {
    id: "house",
    label: "House Blueprint",
    blueprint: cloneBlueprint(houseBlueprint),
  },
  car: {
    id: "car",
    label: "Vehicle Blueprint",
    blueprint: cloneBlueprint(carBlueprint),
  },
} as const;

export type ExampleId = keyof typeof editorExamples;

export function getExampleBlueprint(id: ExampleId): Blueprint {
  return cloneBlueprint(editorExamples[id].blueprint);
}
