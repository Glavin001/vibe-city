"use client";

import { useRef, useEffect } from "react";
import { Box, Plane, Text, Cylinder, Sphere } from "@react-three/drei";
import { RigidBody } from "@react-three/rapier";
import type { RapierRigidBody } from "@react-three/rapier";
import { MaterialType } from "@/lib/ballistic-raylab/types";
import type * as THREE from "three";

interface MaterialWallProps {
  position: [number, number, number];
  rotation?: [number, number, number];
  size: [number, number, number];
  type: MaterialType;
  label?: string;
  opacity?: number;
}

const MaterialWall: React.FC<MaterialWallProps> = ({
  position,
  size,
  type,
  rotation = [0, 0, 0],
  label,
  opacity,
}) => {
  const color =
    type === MaterialType.GLASS
      ? "#a5f3fc"
      : type === MaterialType.WOOD
        ? "#7c4a3a"
        : type === MaterialType.CONCRETE
          ? "#94a3b8"
          : type === MaterialType.METAL
            ? "#64748b"
            : type === MaterialType.DRYWALL
              ? "#e2e8f0"
              : "#fff";

  const isGlass = type === MaterialType.GLASS;
  const finalOpacity = opacity !== undefined ? opacity : isGlass ? 0.3 : 1;
  const transparent = isGlass || finalOpacity < 1;

  return (
    <group position={position} rotation={rotation}>
      {label && (
        <Text
          position={[0, 0, size[2] / 2 + 0.05]} // Slightly in front
          fontSize={0.2}
          color="white"
          anchorX="center"
          anchorY="middle"
          rotation={[0, Math.PI, 0]} // Face inwards usually
          outlineWidth={0.02}
          outlineColor="#000"
        >
          {label}
        </Text>
      )}
      {/*
        Fixed RigidBodies for Walls.
        userData.materialType is read by the Raycaster Service for penetration logic.
      */}
      <RigidBody type="fixed" colliders="cuboid">
        <Box args={size} userData={{ materialType: type }}>
          <meshStandardMaterial
            color={color}
            roughness={isGlass ? 0.1 : 0.8}
            metalness={type === MaterialType.METAL ? 0.8 : 0.1}
            transparent={transparent}
            opacity={finalOpacity}
            side={2} // DoubleSide to ensure raycast hits from inside
          />
        </Box>
      </RigidBody>
    </group>
  );
};

// --- DYNAMIC PROPS (Physics Enabled) ---

interface PhysicsPropProps {
  position: [number, number, number];
  type: "crate" | "mug" | "lamp" | "ball";
  registerBody: (uuid: string, api: RapierRigidBody) => void;
}

const PhysicsProp: React.FC<PhysicsPropProps> = ({
  position,
  type,
  registerBody,
}) => {
  const api = useRef<RapierRigidBody>(null);
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);

  // Define properties based on type
  const getProps = () => {
    switch (type) {
      case "crate":
        return {
          size: [0.6, 0.6, 0.6],
          mass: 5,
          color: "#8b4513",
          mat: MaterialType.WOOD,
        };
      case "mug":
        return {
          size: [0.15, 0.2, 0.15],
          mass: 0.2,
          color: "#fff",
          mat: MaterialType.GLASS,
        }; // Ceramic
      case "lamp":
        return {
          size: [0.2, 0.4, 0.2],
          mass: 1,
          color: "#facc15",
          mat: MaterialType.METAL,
        };
      case "ball":
        return {
          size: [0.3, 0.3, 0.3],
          mass: 0.5,
          color: "#ef4444",
          mat: MaterialType.FLESH,
        };
    }
    return { size: [1, 1, 1], mass: 1, color: "white", mat: MaterialType.WOOD };
  };

  const p = getProps();

  useEffect(() => {
    // Robust Registration:
    // We must traverse the object and register ALL child mesh UUIDs to the same rigid body API.
    // This ensures that hitting any part of a complex object (like the lamp) applies the force to the body.
    if (api.current) {
      const register = (obj: THREE.Object3D) => {
        if ((obj as THREE.Mesh).isMesh) {
          registerBody(obj.uuid, api.current!);
        }
      };

      if (groupRef.current) {
        groupRef.current.traverse(register);
      }
      if (meshRef.current) {
        register(meshRef.current);
      }
    }
  }, [registerBody, type]);

  return (
    <RigidBody
      ref={api}
      position={position}
      colliders={type === "ball" ? "ball" : "cuboid"}
      mass={p.mass}
      restitution={0.2}
      friction={0.8}
    >
      {type === "crate" && (
        <Box
          args={p.size as [number, number, number]}
          ref={meshRef}
          userData={{ materialType: p.mat, physics: true }}
        >
          <meshStandardMaterial color={p.color} side={2} />
        </Box>
      )}
      {type === "mug" && (
        <Cylinder
          args={[0.08, 0.08, 0.2]}
          ref={meshRef}
          userData={{ materialType: p.mat, physics: true }}
        >
          <meshStandardMaterial color={p.color} side={2} />
        </Cylinder>
      )}
      {type === "lamp" && (
        <group ref={groupRef}>
          {/* Apply userData to children so they are picked up by the Ballistic Raycaster */}
          <Cylinder
            args={[0.05, 0.1, 0.1]}
            position={[0, -0.15, 0]}
            userData={{ materialType: p.mat, physics: true }}
          >
            <meshStandardMaterial color="#333" side={2} />
          </Cylinder>
          <Cylinder
            args={[0.15, 0.05, 0.3]}
            position={[0, 0.1, 0]}
            userData={{ materialType: p.mat, physics: true }}
          >
            <meshStandardMaterial
              color={p.color}
              emissive={p.color}
              emissiveIntensity={0.5}
              side={2}
            />
          </Cylinder>
        </group>
      )}
      {type === "ball" && (
        <Sphere
          args={[0.2]}
          ref={meshRef}
          userData={{ materialType: p.mat, physics: true }}
        >
          <meshStandardMaterial color={p.color} side={2} />
        </Sphere>
      )}
    </RigidBody>
  );
};

interface HouseProps {
  registerBody: (uuid: string, api: RapierRigidBody) => void;
}

const House: React.FC<HouseProps> = ({ registerBody }) => {
  const wallHeight = 3;

  return (
    <group position={[0, 0, 0]}>
      {/* Floor (Concrete) */}
      <RigidBody type="fixed" colliders="cuboid">
        <Box
          args={[12, 0.2, 12]}
          position={[0, -0.1, 0]}
          userData={{ materialType: MaterialType.CONCRETE }}
        >
          <meshStandardMaterial color="#333" roughness={0.9} />
        </Box>
      </RigidBody>

      {/* Ceiling Beams */}
      <MaterialWall
        position={[0, wallHeight, 0]}
        size={[12, 0.2, 0.5]}
        type={MaterialType.METAL}
      />
      <MaterialWall
        position={[0, wallHeight, 3]}
        size={[12, 0.2, 0.5]}
        type={MaterialType.METAL}
      />
      <MaterialWall
        position={[0, wallHeight, -3]}
        size={[12, 0.2, 0.5]}
        type={MaterialType.METAL}
      />

      {/* EXTERIOR WALLS (Concrete) */}
      <MaterialWall
        position={[0, wallHeight / 2, -6]}
        size={[12, wallHeight, 0.3]}
        type={MaterialType.CONCRETE}
        label="Concrete Wall"
      />
      <MaterialWall
        position={[-4, wallHeight / 2, 6]}
        size={[4, wallHeight, 0.3]}
        type={MaterialType.CONCRETE}
      />
      <MaterialWall
        position={[4, wallHeight / 2, 6]}
        size={[4, wallHeight, 0.3]}
        type={MaterialType.CONCRETE}
      />
      <MaterialWall
        position={[0, 2.5, 6]}
        size={[4, 1, 0.3]}
        type={MaterialType.CONCRETE}
      />
      <MaterialWall
        position={[-6, wallHeight / 2, 0]}
        size={[0.3, wallHeight, 12]}
        type={MaterialType.CONCRETE}
      />
      <MaterialWall
        position={[6, wallHeight / 2, 4]}
        size={[0.3, wallHeight, 4]}
        type={MaterialType.CONCRETE}
      />
      <MaterialWall
        position={[6, wallHeight / 2, -4]}
        size={[0.3, wallHeight, 4]}
        type={MaterialType.CONCRETE}
      />
      <MaterialWall
        position={[6, 0.5, 0]}
        size={[0.3, 1, 4]}
        type={MaterialType.CONCRETE}
      />
      <MaterialWall
        position={[6, 2.5, 0]}
        size={[0.3, 1, 4]}
        type={MaterialType.CONCRETE}
      />

      {/* WINDOW */}
      <MaterialWall
        position={[6, 1.5, 0]}
        size={[0.05, 2, 4]}
        type={MaterialType.GLASS}
        label="Glass Window"
      />

      {/* INTERIOR WALLS (Drywall) */}
      <MaterialWall
        position={[-2, wallHeight / 2, -2]}
        size={[8, wallHeight, 0.1]}
        type={MaterialType.DRYWALL}
        label="Drywall Partition"
      />
      <MaterialWall
        position={[2, wallHeight / 2, 2]}
        size={[0.1, wallHeight, 8]}
        type={MaterialType.DRYWALL}
      />

      {/* --- FURNITURE (Static) --- */}
      {/* Kitchen Island */}
      <group position={[-2, 0.5, 3]}>
        <MaterialWall
          position={[0, 0, 0]}
          size={[2, 1, 1]}
          type={MaterialType.CONCRETE}
          label="Marble Counter"
        />
        {/* Props on counter */}
        <PhysicsProp
          type="mug"
          position={[0.5, 0.7, 0]}
          registerBody={registerBody}
        />
        <PhysicsProp
          type="mug"
          position={[0.2, 0.7, 0.2]}
          registerBody={registerBody}
        />
        <PhysicsProp
          type="lamp"
          position={[-0.5, 0.7, 0]}
          registerBody={registerBody}
        />
      </group>

      {/* Fridge */}
      <MaterialWall
        position={[-5, 1, 5]}
        size={[1.5, 2, 1.5]}
        type={MaterialType.METAL}
        label="Metal Fridge"
      />

      {/* Wooden Table */}
      <group position={[3, 0.4, -3]}>
        <MaterialWall
          position={[0, 0.4, 0]}
          size={[2, 0.1, 1.5]}
          type={MaterialType.WOOD}
          label="Oak Table"
        />
        <MaterialWall
          position={[-0.9, 0, -0.6]}
          size={[0.1, 0.8, 0.1]}
          type={MaterialType.WOOD}
        />
        <MaterialWall
          position={[0.9, 0, -0.6]}
          size={[0.1, 0.8, 0.1]}
          type={MaterialType.WOOD}
        />
        <MaterialWall
          position={[-0.9, 0, 0.6]}
          size={[0.1, 0.8, 0.1]}
          type={MaterialType.WOOD}
        />
        <MaterialWall
          position={[0.9, 0, 0.6]}
          size={[0.1, 0.8, 0.1]}
          type={MaterialType.WOOD}
        />

        {/* Props on table */}
        <PhysicsProp
          type="mug"
          position={[0, 0.6, 0]}
          registerBody={registerBody}
        />
        <PhysicsProp
          type="crate"
          position={[0.5, 1, -0.2]}
          registerBody={registerBody}
        />
      </group>

      {/* Scattered Props */}
      <PhysicsProp
        type="crate"
        position={[-4, 2, -4]}
        registerBody={registerBody}
      />
      <PhysicsProp
        type="crate"
        position={[-4, 0.5, -4]}
        registerBody={registerBody}
      />
      <PhysicsProp
        type="crate"
        position={[-3.5, 0.5, -3.5]}
        registerBody={registerBody}
      />
      <PhysicsProp
        type="ball"
        position={[2, 2, 0]}
        registerBody={registerBody}
      />

      {/* Glass Pane */}
      <MaterialWall
        position={[0, 1.5, 0]}
        rotation={[0, Math.PI / 4, 0]}
        size={[2, 3, 0.05]}
        type={MaterialType.GLASS}
        label="Glass Art"
      />
    </group>
  );
};

export const SceneEnvironment: React.FC<{
  registerBody: (uuid: string, api: RapierRigidBody) => void;
}> = ({ registerBody }) => {
  return (
    <group>
      {/* Ground outside house */}
      <RigidBody type="fixed" colliders="cuboid">
        <Plane
          args={[100, 100]}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, -0.15, 0]}
          userData={{ materialType: MaterialType.DRYWALL }}
        >
          <meshStandardMaterial color="#1a1a1a" />
        </Plane>
      </RigidBody>
      <gridHelper args={[100, 100]} position={[0, -0.14, 0]} />

      <ambientLight intensity={0.4} />
      <directionalLight position={[20, 30, 10]} intensity={1.5} castShadow />
      <pointLight
        position={[0, 2.5, 0]}
        intensity={0.8}
        color="#fbbf24"
        distance={10}
      />
      <pointLight
        position={[-3, 2.5, 4]}
        intensity={0.8}
        color="#fff"
        distance={8}
      />

      <House registerBody={registerBody} />
    </group>
  );
};



