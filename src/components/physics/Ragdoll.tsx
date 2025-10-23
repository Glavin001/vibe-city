"use client";

import { forwardRef, useEffect, useMemo, useRef } from "react";
import { RigidBody, type RapierRigidBody, CuboidCollider, useRevoluteJoint, useSphericalJoint } from "@react-three/rapier";
import { Euler, Quaternion, Vector3 } from "three";

export type RagdollOrientation =
  | { euler?: [number, number, number] }
  | { quat?: [number, number, number, number] };

export type OrientationPreset = "upright" | "headfirst" | "side" | "faceDown" | "random";

export function createRagdollOrientation(preset: OrientationPreset): RagdollOrientation {
  switch (preset) {
    case "upright":
      return { euler: [0, 0, 0] };
    case "headfirst":
      return { euler: [Math.PI / 2, 0, 0] };
    case "side":
      return { euler: [0, 0, Math.PI / 2] };
    case "faceDown":
      return { euler: [Math.PI, 0, 0] };
    case "random":
    default: {
      const rx = (Math.random() - 0.5) * Math.PI * 2;
      const ry = (Math.random() - 0.5) * Math.PI * 2;
      const rz = (Math.random() - 0.5) * Math.PI * 2;
      return { euler: [rx, ry, rz] };
    }
  }
}

export type RagdollLimits = {
  elbows?: [number, number];
  knees?: [number, number];
};

export type RagdollProps = {
  position: [number, number, number];
  orientation?: RagdollOrientation;
  scale?: number;
  density?: number;
  friction?: number;
  color?: string;
  limits?: RagdollLimits;
  name?: string;
};

const DEFAULT_LIMITS: Required<RagdollLimits> = {
  elbows: [-2.4, 0.1],
  knees: [-2.6, 0.05],
};

function Part({ w, h, d, color }: { w: number; h: number; d: number; color: string }) {
  return (
    <mesh castShadow receiveShadow>
      <boxGeometry args={[w, h, d]} />
      <meshStandardMaterial color={color} roughness={0.45} metalness={0.05} />
    </mesh>
  );
}

export const Ragdoll = forwardRef<RapierRigidBody | null, RagdollProps>(function Ragdoll(
  { position, orientation, scale = 1, density = 500, friction = 0.6, color = "#9ca3af", limits = DEFAULT_LIMITS, name },
  _
) {
  // Dimensions (meters), roughly human-like, scaled
  const sizes = useMemo(() => {
    const torsoW = 0.35 * scale;
    const torsoH = 0.45 * scale;
    const torsoD = 0.22 * scale;
    const pelvisW = 0.32 * scale;
    const pelvisH = 0.22 * scale;
    const pelvisD = 0.22 * scale;
    const head = 0.22 * scale;
    const upperArmL = 0.32 * scale;
    const upperArmR = upperArmL;
    const armT = 0.14 * scale;
    const lowerArmL = 0.28 * scale;
    const lowerArmR = lowerArmL;
    const thighL = 0.42 * scale;
    const thighR = thighL;
    const shinL = 0.42 * scale;
    const shinR = shinL;
    const legT = 0.16 * scale;
    return {
      torsoW, torsoH, torsoD,
      pelvisW, pelvisH, pelvisD,
      head,
      upperArmL, upperArmR, armT,
      lowerArmL, lowerArmR,
      thighL, thighR, shinL, shinR, legT,
    };
  }, [scale]);

  // Body refs
  const pelvis = useRef<RapierRigidBody>(null as unknown as RapierRigidBody);
  const torso = useRef<RapierRigidBody>(null as unknown as RapierRigidBody);
  const head = useRef<RapierRigidBody>(null as unknown as RapierRigidBody);
  const upperArmL = useRef<RapierRigidBody>(null as unknown as RapierRigidBody);
  const lowerArmL = useRef<RapierRigidBody>(null as unknown as RapierRigidBody);
  const upperArmR = useRef<RapierRigidBody>(null as unknown as RapierRigidBody);
  const lowerArmR = useRef<RapierRigidBody>(null as unknown as RapierRigidBody);
  const thighL = useRef<RapierRigidBody>(null as unknown as RapierRigidBody);
  const shinL = useRef<RapierRigidBody>(null as unknown as RapierRigidBody);
  const thighR = useRef<RapierRigidBody>(null as unknown as RapierRigidBody);
  const shinR = useRef<RapierRigidBody>(null as unknown as RapierRigidBody);

  // Orientation handling
  const rotEuler = ("euler" in (orientation || {}) && (orientation as { euler?: [number, number, number] }).euler) || [0, 0, 0];
  const rotQuatArr = ("quat" in (orientation || {}) && (orientation as { quat?: [number, number, number, number] }).quat) || undefined;
  const orientationQuat = useMemo(() => {
    if (rotQuatArr) return new Quaternion(rotQuatArr[0], rotQuatArr[1], rotQuatArr[2], rotQuatArr[3]);
    const e = new Euler(rotEuler[0], rotEuler[1], rotEuler[2]);
    const q = new Quaternion();
    q.setFromEuler(e);
    return q;
  }, [rotQuatArr, rotEuler]);
  const rotationEuler: [number, number, number] = useMemo(() => {
    const e = new Euler().setFromQuaternion(orientationQuat);
    return [e.x, e.y, e.z];
  }, [orientationQuat]);

  // Clearances to avoid initial collider overlap; tweak as needed
  const JOINT_CLEARANCE = 0.01 * scale; // meters, small gap at elbows/knees/hips
  const SHOULDER_CLEARANCE = 0.02 * scale; // meters, push arms slightly outward from torso

  // Joint hookups
  // Neck (spherical): head ↔ torso
  useSphericalJoint(head, torso, [
    [0, -sizes.head / 2, 0],
    [0, sizes.torsoH / 2, 0],
  ]);
  // Spine (fixed-ish using spherical close anchors): torso ↔ pelvis
  useSphericalJoint(torso, pelvis, [
    [0, -sizes.torsoH / 2, 0],
    [0, sizes.pelvisH / 2, 0],
  ]);
  // Shoulders (spherical): torso ↔ upper arms
  useSphericalJoint(torso, upperArmL, [
    [-sizes.torsoW / 2 - SHOULDER_CLEARANCE / 2, sizes.torsoH / 2 - sizes.armT * 0.2, 0],
    [sizes.upperArmL / 2 + SHOULDER_CLEARANCE / 2, 0, 0],
  ]);
  useSphericalJoint(torso, upperArmR, [
    [sizes.torsoW / 2 + SHOULDER_CLEARANCE / 2, sizes.torsoH / 2 - sizes.armT * 0.2, 0],
    [-sizes.upperArmR / 2 - SHOULDER_CLEARANCE / 2, 0, 0],
  ]);
  // Elbows (revolute): upper ↔ lower arms around local Z axis (bend in X-Y plane)
  const elbowL = useRevoluteJoint(upperArmL, lowerArmL, [
    [-sizes.upperArmL / 2 - JOINT_CLEARANCE / 2, 0, 0],
    [sizes.lowerArmL / 2 + JOINT_CLEARANCE / 2, 0, 0],
    [0, 0, 1],
  ]);
  const elbowR = useRevoluteJoint(upperArmR, lowerArmR, [
    [sizes.upperArmR / 2 + JOINT_CLEARANCE / 2, 0, 0],
    [-sizes.lowerArmR / 2 - JOINT_CLEARANCE / 2, 0, 0],
    [0, 0, 1],
  ]);
  // Hips (spherical): pelvis ↔ thighs
  useSphericalJoint(pelvis, thighL, [
    [-sizes.pelvisW / 2 + sizes.legT * 0.3, -sizes.pelvisH / 2 - JOINT_CLEARANCE / 2, 0],
    [0, sizes.thighL / 2 + JOINT_CLEARANCE / 2, 0],
  ]);
  useSphericalJoint(pelvis, thighR, [
    [sizes.pelvisW / 2 - sizes.legT * 0.3, -sizes.pelvisH / 2 - JOINT_CLEARANCE / 2, 0],
    [0, sizes.thighR / 2 + JOINT_CLEARANCE / 2, 0],
  ]);
  // Knees (revolute): thighs ↔ shins around local Z
  const kneeL = useRevoluteJoint(thighL, shinL, [
    [0, -sizes.thighL / 2 - JOINT_CLEARANCE / 2, 0],
    [0, sizes.shinL / 2 + JOINT_CLEARANCE / 2, 0],
    [0, 0, 1],
  ]);
  const kneeR = useRevoluteJoint(thighR, shinR, [
    [0, -sizes.thighR / 2 - JOINT_CLEARANCE / 2, 0],
    [0, sizes.shinR / 2 + JOINT_CLEARANCE / 2, 0],
    [0, 0, 1],
  ]);

  // Apply joint limits (best-effort; only if supported)
  useEffect(() => {
    try {
      // @ts-expect-error - runtime method names vary by Rapier version
      elbowL?.setLimits?.(limits.elbows?.[0] ?? DEFAULT_LIMITS.elbows[0], limits.elbows?.[1] ?? DEFAULT_LIMITS.elbows[1]);
      // @ts-expect-error
      elbowR?.setLimits?.(limits.elbows?.[0] ?? DEFAULT_LIMITS.elbows[0], limits.elbows?.[1] ?? DEFAULT_LIMITS.elbows[1]);
      // @ts-expect-error
      kneeL?.setLimits?.(limits.knees?.[0] ?? DEFAULT_LIMITS.knees[0], limits.knees?.[1] ?? DEFAULT_LIMITS.knees[1]);
      // @ts-expect-error
      kneeR?.setLimits?.(limits.knees?.[0] ?? DEFAULT_LIMITS.knees[0], limits.knees?.[1] ?? DEFAULT_LIMITS.knees[1]);
    } catch {
      // Ignore if API mismatch; joints still behave as hinges without explicit limits
    }
  }, [elbowL, elbowR, kneeL, kneeR, limits]);

  // Initial transforms for each part relative to the spawn position
  const baseY = position[1];
  const start = useMemo(() => {
    const pelvisPos: [number, number, number] = [position[0], baseY, position[2]];
    const torsoPos: [number, number, number] = [position[0], baseY + sizes.pelvisH / 2 + sizes.torsoH / 2, position[2]];
    const headPos: [number, number, number] = [position[0], torsoPos[1] + sizes.torsoH / 2 + sizes.head / 2, position[2]];
    const uArmLY = torsoPos[1] + sizes.torsoH / 2 - sizes.armT * 0.2;
    const uArmRY = uArmLY;
    const uArmLX = torsoPos[0] - (sizes.torsoW / 2 + sizes.upperArmL / 2 + SHOULDER_CLEARANCE);
    const uArmRX = torsoPos[0] + (sizes.torsoW / 2 + sizes.upperArmR / 2 + SHOULDER_CLEARANCE);
    const lArmLX = uArmLX - sizes.lowerArmL / 2 - sizes.upperArmL / 2 - JOINT_CLEARANCE;
    const lArmRX = uArmRX + sizes.lowerArmR / 2 + sizes.upperArmR / 2 + JOINT_CLEARANCE;
    const thighLY = pelvisPos[1] - sizes.pelvisH / 2 - sizes.thighL / 2 - JOINT_CLEARANCE;
    const thighRY = thighLY;
    const thighLX = pelvisPos[0] - sizes.pelvisW / 2 + sizes.legT * 0.3;
    const thighRX = pelvisPos[0] + sizes.pelvisW / 2 - sizes.legT * 0.3;
    const shinLY = thighLY - sizes.thighL / 2 - sizes.shinL / 2 - JOINT_CLEARANCE;
    const shinRY = shinLY;
    return {
      pelvisPos,
      torsoPos,
      headPos,
      upperArmLPos: [uArmLX, uArmLY, position[2]] as [number, number, number],
      upperArmRPos: [uArmRX, uArmRY, position[2]] as [number, number, number],
      lowerArmLPos: [lArmLX, uArmLY, position[2]] as [number, number, number],
      lowerArmRPos: [lArmRX, uArmRY, position[2]] as [number, number, number],
      thighLPos: [thighLX, thighLY, position[2]] as [number, number, number],
      thighRPos: [thighRX, thighRY, position[2]] as [number, number, number],
      shinLPos: [thighLX, shinLY, position[2]] as [number, number, number],
      shinRPos: [thighRX, shinRY, position[2]] as [number, number, number],
    };
  }, [position, sizes, baseY]);

  // Common props
  const common = useMemo(() => ({
    density,
    friction,
    linearDamping: 0.02,
    angularDamping: 0.02,
  }), [density, friction]);

  // Helper to rotate a position around pelvis pivot by orientationQuat
  const rotatePos = useMemo(() => {
    const pivot = new Vector3(start.pelvisPos[0], start.pelvisPos[1], start.pelvisPos[2]);
    return (p: [number, number, number]) => {
      const v = new Vector3(p[0], p[1], p[2]);
      v.sub(pivot).applyQuaternion(orientationQuat).add(pivot);
      return [v.x, v.y, v.z] as [number, number, number];
    };
  }, [start.pelvisPos, orientationQuat]);

  return (
    <group name={name}>
      {/* Pelvis */}
      <RigidBody ref={pelvis} position={rotatePos(start.pelvisPos)} rotation={rotationEuler} {...common} colliders={false}>
        <CuboidCollider args={[sizes.pelvisW / 2, sizes.pelvisH / 2, sizes.pelvisD / 2]} />
        <Part w={sizes.pelvisW} h={sizes.pelvisH} d={sizes.pelvisD} color={color} />
      </RigidBody>
      {/* Torso */}
      <RigidBody ref={torso} position={rotatePos(start.torsoPos)} rotation={rotationEuler} {...common} colliders={false}>
        <CuboidCollider args={[sizes.torsoW / 2, sizes.torsoH / 2, sizes.torsoD / 2]} />
        <Part w={sizes.torsoW} h={sizes.torsoH} d={sizes.torsoD} color={color} />
      </RigidBody>
      {/* Head */}
      <RigidBody ref={head} position={rotatePos(start.headPos)} rotation={rotationEuler} {...common} colliders={false}>
        <CuboidCollider args={[sizes.head / 2, sizes.head / 2, sizes.head / 2]} />
        <Part w={sizes.head} h={sizes.head} d={sizes.head} color={color} />
      </RigidBody>
      {/* Arms */}
      <RigidBody ref={upperArmL} position={rotatePos(start.upperArmLPos)} rotation={rotationEuler} {...common} colliders={false}>
        <CuboidCollider args={[sizes.upperArmL / 2, sizes.armT / 2, sizes.armT / 2]} />
        <Part w={sizes.upperArmL} h={sizes.armT} d={sizes.armT} color={color} />
      </RigidBody>
      <RigidBody ref={lowerArmL} position={rotatePos(start.lowerArmLPos)} rotation={rotationEuler} {...common} colliders={false}>
        <CuboidCollider args={[sizes.lowerArmL / 2, sizes.armT / 2, sizes.armT / 2]} />
        <Part w={sizes.lowerArmL} h={sizes.armT} d={sizes.armT} color={color} />
      </RigidBody>
      <RigidBody ref={upperArmR} position={rotatePos(start.upperArmRPos)} rotation={rotationEuler} {...common} colliders={false}>
        <CuboidCollider args={[sizes.upperArmR / 2, sizes.armT / 2, sizes.armT / 2]} />
        <Part w={sizes.upperArmR} h={sizes.armT} d={sizes.armT} color={color} />
      </RigidBody>
      <RigidBody ref={lowerArmR} position={rotatePos(start.lowerArmRPos)} rotation={rotationEuler} {...common} colliders={false}>
        <CuboidCollider args={[sizes.lowerArmR / 2, sizes.armT / 2, sizes.armT / 2]} />
        <Part w={sizes.lowerArmR} h={sizes.armT} d={sizes.armT} color={color} />
      </RigidBody>
      {/* Legs */}
      <RigidBody ref={thighL} position={rotatePos(start.thighLPos)} rotation={rotationEuler} {...common} colliders={false}>
        <CuboidCollider args={[sizes.legT / 2, sizes.thighL / 2, sizes.legT / 2]} />
        <Part w={sizes.legT} h={sizes.thighL} d={sizes.legT} color={color} />
      </RigidBody>
      <RigidBody ref={shinL} position={rotatePos(start.shinLPos)} rotation={rotationEuler} {...common} colliders={false}>
        <CuboidCollider args={[sizes.legT / 2, sizes.shinL / 2, sizes.legT / 2]} />
        <Part w={sizes.legT} h={sizes.shinL} d={sizes.legT} color={color} />
      </RigidBody>
      <RigidBody ref={thighR} position={rotatePos(start.thighRPos)} rotation={rotationEuler} {...common} colliders={false}>
        <CuboidCollider args={[sizes.legT / 2, sizes.thighR / 2, sizes.legT / 2]} />
        <Part w={sizes.legT} h={sizes.thighR} d={sizes.legT} color={color} />
      </RigidBody>
      <RigidBody ref={shinR} position={rotatePos(start.shinRPos)} rotation={rotationEuler} {...common} colliders={false}>
        <CuboidCollider args={[sizes.legT / 2, sizes.shinR / 2, sizes.legT / 2]} />
        <Part w={sizes.legT} h={sizes.shinR} d={sizes.legT} color={color} />
      </RigidBody>
    </group>
  );
});

export default Ragdoll;


