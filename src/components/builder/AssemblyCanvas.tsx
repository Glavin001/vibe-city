"use client";

import React, {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Canvas, ThreeEvent, useFrame } from "@react-three/fiber";
import {
  Grid,
  OrbitControls,
  TransformControls,
} from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { TransformControls as TransformControlsImpl } from "three/examples/jsm/controls/TransformControls";
import {
  CuboidCollider,
  CylinderCollider,
  Physics,
  RigidBody,
  useFixedJoint,
  useRevoluteJoint,
  type RapierImpulseJoint,
  type RapierRigidBody,
} from "@react-three/rapier";
import { Color, Group, Quaternion, Vector3 } from "three";

import type {
  Blueprint,
  Catalog,
  ColliderDef,
  JointInstance,
  JointTemplate,
  PartDef,
  PartInstance,
  Transform,
} from "@/lib/builder/model";
import {
  quaternionToArray,
  quaternionToEuler,
  vectorToArray,
} from "@/lib/builder/math";
import { findPartInstance } from "@/lib/builder/utils";

const identityQuat: Transform["rotationQuat"] = [0, 0, 0, 1];
const defaultStructuralColor = new Color("#9ca3af");
const defaultMechanicalColor = new Color("#1f2937");

interface AssemblyCanvasProps {
  blueprint: Blueprint;
  catalog: Catalog;
  mode: "edit" | "simulate";
  selectedPartId?: string | null;
  onSelectPart?: (id: string | null) => void;
  onTransformChange?: (id: string, transform: Transform) => void;
  transformMode: "translate" | "rotate";
  jointTargets?: Record<string, number | undefined>;
}

interface RegisteredBody {
  id: string;
  api: RapierRigidBody;
  part: PartInstance;
  partDef: PartDef;
  object: Group | null;
}

interface RegisteredJoint {
  id: string;
  joint: RapierImpulseJoint;
  instance: JointInstance;
  template: JointTemplate;
}

interface AssemblyRuntimeContextValue {
  bodies: Map<string, RegisteredBody>;
  joints: Map<string, RegisteredJoint>;
  registerBody: (entry: RegisteredBody) => void;
  unregisterBody: (id: string) => void;
  registerJoint: (entry: RegisteredJoint) => void;
  unregisterJoint: (id: string) => void;
  version: number;
}

const AssemblyRuntimeContext = React.createContext<AssemblyRuntimeContextValue | null>(
  null,
);

function useAssemblyRuntime() {
  const ctx = React.useContext(AssemblyRuntimeContext);
  if (!ctx) {
    throw new Error("Assembly runtime context is missing");
  }
  return ctx;
}

function highlightColor(hex: string | undefined, selected: boolean): string {
  const base = new Color(hex ?? defaultStructuralColor);
  if (selected) {
    const highlight = base.clone().lerp(new Color("#f97316"), 0.4);
    return `#${highlight.getHexString()}`;
  }
  return `#${base.getHexString()}`;
}

function colliderRotationEuler(collider: ColliderDef): [number, number, number] {
  const rotation = collider.offset?.rotationQuat ?? identityQuat;
  return quaternionToEuler(rotation);
}

function ColliderPrimitive({ collider }: { collider: ColliderDef }) {
  const position = collider.offset?.position ?? [0, 0, 0];
  const rotation = colliderRotationEuler(collider);
  const friction = collider.material?.friction;
  const restitution = collider.material?.restitution;

  switch (collider.shape) {
    case "box":
      return (
        <CuboidCollider
          args={collider.params as [number, number, number]}
          position={position}
          rotation={rotation}
          friction={friction}
          restitution={restitution}
        />
      );
    case "cylinder": {
      const [radius, halfHeight] = collider.params;
      return (
        <CylinderCollider
          args={[halfHeight ?? collider.params[1], radius ?? collider.params[0]]}
          position={position}
          rotation={rotation}
          friction={friction}
          restitution={restitution}
        />
      );
    }
    default:
      return null;
  }
}

interface PartRigidBodyProps {
  part: PartInstance;
  partDef: PartDef;
  mode: "edit" | "simulate";
  selected: boolean;
  onSelect?: (id: string) => void;
}

function PartRigidBody({
  part,
  partDef,
  mode,
  selected,
  onSelect,
}: PartRigidBodyProps) {
  const bodyRef = useRef<RapierRigidBody>(null);
  const groupRef = useRef<Group>(null);
  const runtime = useAssemblyRuntime();
  const isDynamic = partDef.physics?.dynamic ?? false;
  const type = mode === "edit" ? "kinematicPosition" : isDynamic ? "dynamic" : "fixed";
  const rotationEuler = quaternionToEuler(part.transform.rotationQuat);
  const transformKey = useMemo(
    () =>
      `${part.transform.position.join(",")}|${part.transform.rotationQuat.join(",")}`,
    [part.transform.position, part.transform.rotationQuat],
  );

  useEffect(() => {
    const body = bodyRef.current;
    const object = groupRef.current;
    if (!body || !object) return;
    runtime.registerBody({
      id: part.id,
      api: body,
      part,
      partDef,
      object,
    });
    return () => runtime.unregisterBody(part.id);
  }, [part, partDef, runtime]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const [x, y, z] = part.transform.position;
    const [qx, qy, qz, qw] = part.transform.rotationQuat;
    body.setTranslation({ x, y, z }, true);
    body.setRotation({ x: qx, y: qy, z: qz, w: qw }, true);
    if (mode === "simulate" && isDynamic) {
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }, [transformKey, mode, isDynamic]);

  const handlePointerDown = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation();
      onSelect?.(part.id);
    },
    [onSelect, part.id],
  );

  const colliders = partDef.physics?.colliders ?? [];
  const colliderElements = colliders.map((collider, index) => (
    <ColliderPrimitive key={`${part.id}-collider-${index}`} collider={collider} />
  ));

  return (
    <RigidBody
      ref={bodyRef}
      type={type}
      colliders={false}
      position={part.transform.position}
      rotation={rotationEuler}
      mass={partDef.physics?.mass}
      enabledTranslations={mode === "edit" ? [true, true, true] : undefined}
      enabledRotations={mode === "edit" ? [true, true, true] : undefined}
    >
      <group ref={groupRef} userData={{ partInstanceId: part.id }}>
        <PartVisual
          part={part}
          partDef={partDef}
          selected={selected}
          onPointerDown={handlePointerDown}
        />
      </group>
      {colliderElements}
    </RigidBody>
  );
}

interface PartVisualProps {
  part: PartInstance;
  partDef: PartDef;
  selected: boolean;
  onPointerDown: (event: ThreeEvent<MouseEvent>) => void;
}

function PartVisual({
  part,
  partDef,
  selected,
  onPointerDown,
}: PartVisualProps) {
  const collider = partDef.physics?.colliders[0];
  const color = highlightColor(
    partDef.metadata?.color ??
      (partDef.category === "mechanical"
        ? `#${defaultMechanicalColor.getHexString()}`
        : `#${defaultStructuralColor.getHexString()}`),
    selected,
  );

  if (!collider) {
    return null;
  }

  switch (collider.shape) {
    case "box": {
      const [hx, hy, hz] = collider.params;
      return (
        <mesh
          name={part.label ?? part.id}
          castShadow
          receiveShadow
          onPointerDown={onPointerDown}
        >
          <boxGeometry args={[hx * 2, hy * 2, hz * 2]} />
          <meshStandardMaterial color={color} roughness={0.6} metalness={0.1} />
        </mesh>
      );
    }
    case "cylinder": {
      const [radius, halfHeight] = collider.params;
      return (
        <mesh
          name={part.label ?? part.id}
          castShadow
          receiveShadow
          rotation={[0, 0, Math.PI / 2]}
          onPointerDown={onPointerDown}
        >
          <cylinderGeometry args={[radius, radius, (halfHeight ?? 0.12) * 2, 24]} />
          <meshStandardMaterial color={color} roughness={0.5} metalness={0.2} />
        </mesh>
      );
    }
    default:
      return null;
  }
}

interface AssemblyBodiesProps {
  blueprint: Blueprint;
  catalog: Catalog;
  mode: "edit" | "simulate";
  selectedPartId?: string | null;
  onSelectPart?: (id: string) => void;
}

function AssemblyBodies({
  blueprint,
  catalog,
  mode,
  selectedPartId,
  onSelectPart,
}: AssemblyBodiesProps) {
  return (
    <Fragment>
      {blueprint.root.parts.map((part) => {
        const partDef = catalog.parts[part.partId];
        if (!partDef) return null;
        return (
          <PartRigidBody
            key={`${part.id}-${mode}`}
            part={part}
            partDef={partDef}
            mode={mode}
            selected={selectedPartId === part.id}
            onSelect={onSelectPart}
          />
        );
      })}
    </Fragment>
  );
}

function socketTransform(
  part: PartInstance,
  partDef: PartDef,
  socketId: string,
): Transform {
  const socket = partDef.sockets.find((s) => s.id === socketId);
  if (!socket) {
    return {
      position: [0, 0, 0],
      rotationQuat: identityQuat,
    };
  }
  return socket.frame;
}

interface JointRendererProps {
  joint: JointInstance;
  template: JointTemplate;
  catalog: Catalog;
  blueprint: Blueprint;
  jointTarget?: number;
}

function JointRenderer({
  joint,
  template,
  catalog,
  blueprint,
  jointTarget,
}: JointRendererProps) {
  const runtime = useAssemblyRuntime();
  const partA = findPartInstance(blueprint, joint.a.partInstanceId);
  const partB = findPartInstance(blueprint, joint.b.partInstanceId);
  if (!partA || !partB) return null;
  const partDefA = catalog.parts[partA.partId];
  const partDefB = catalog.parts[partB.partId];
  if (!partDefA || !partDefB) return null;

  const bodyA = runtime.bodies.get(partA.id)?.api ?? null;
  const bodyB = runtime.bodies.get(partB.id)?.api ?? null;

  if (!bodyA || !bodyB) {
    return null;
  }

  const socketA = socketTransform(partA, partDefA, joint.a.socketId);
  const socketB = socketTransform(partB, partDefB, joint.b.socketId);

  if (template.type === "fixed") {
    return (
      <FixedJointComponent
        joint={joint}
        template={template}
        bodyA={bodyA}
        bodyB={bodyB}
        socketA={socketA}
        socketB={socketB}
      />
    );
  }

  if (template.type === "revolute") {
    return (
      <RevoluteJointComponent
        joint={joint}
        template={template}
        bodyA={bodyA}
        bodyB={bodyB}
        socketA={socketA}
        socketB={socketB}
        target={jointTarget}
      />
    );
  }

  return null;
}

interface RevoluteJointComponentProps {
  joint: JointInstance;
  template: JointTemplate;
  bodyA: RapierRigidBody;
  bodyB: RapierRigidBody;
  socketA: Transform;
  socketB: Transform;
  target?: number;
}

function RevoluteJointComponent({
  joint,
  template,
  bodyA,
  bodyB,
  socketA,
  socketB,
  target,
}: RevoluteJointComponentProps) {
  const runtime = useAssemblyRuntime();
  const localAnchorA = socketA.position;
  const localAnchorB = socketB.position;
  const axis = template.axis ?? [0, 1, 0];
  const limits = joint.limitsOverride ?? template.limits;

  const [jointRef, rapierJoint] = useRevoluteJoint(bodyA, bodyB, {
    localAnchorA,
    localAnchorB,
    axis,
  });

  useEffect(() => {
    if (rapierJoint && limits) {
      rapierJoint.setLimits(limits.lower, limits.upper);
    }
  }, [rapierJoint, limits?.lower, limits?.upper]);

  useEffect(() => {
    if (!rapierJoint) return;
    runtime.registerJoint({
      id: joint.id,
      joint: rapierJoint,
      instance: joint,
      template,
    });
    return () => runtime.unregisterJoint(joint.id);
  }, [rapierJoint, runtime, joint, template]);

  useEffect(() => {
    if (!rapierJoint || template.drive?.mode !== "position") return;
    const stiffness = joint.driveOverride?.stiffness ?? template.drive.stiffness ?? 30;
    const damping = joint.driveOverride?.damping ?? template.drive.damping ?? 4;
    const maxForce = joint.driveOverride?.maxForce ?? template.drive.maxForce ?? 200;
    const targetValue = target ?? joint.driveOverride?.target ?? template.drive.target ?? 0;
    rapierJoint.configureMotorPosition(targetValue, stiffness, damping);
  }, [rapierJoint, template.drive, joint.driveOverride, target]);

  useEffect(() => {
    if (!rapierJoint || template.drive?.mode !== "velocity") return;
    const maxForce = joint.driveOverride?.maxForce ?? template.drive.maxForce ?? 200;
    const targetValue = joint.driveOverride?.target ?? template.drive.target ?? 0;
    rapierJoint.configureMotorVelocity(targetValue, maxForce);
  }, [rapierJoint, template.drive, joint.driveOverride]);

  return <primitive object={jointRef} />;
}

interface FixedJointComponentProps {
  joint: JointInstance;
  template: JointTemplate;
  bodyA: RapierRigidBody;
  bodyB: RapierRigidBody;
  socketA: Transform;
  socketB: Transform;
}

function FixedJointComponent({
  joint,
  template,
  bodyA,
  bodyB,
  socketA,
  socketB,
}: FixedJointComponentProps) {
  const runtime = useAssemblyRuntime();
  const [jointRef, rapierJoint] = useFixedJoint(bodyA, bodyB, {
    localAnchorA: socketA.position,
    localAnchorB: socketB.position,
  });

  useEffect(() => {
    if (!rapierJoint) return;
    runtime.registerJoint({
      id: joint.id,
      joint: rapierJoint,
      instance: joint,
      template,
    });
    return () => runtime.unregisterJoint(joint.id);
  }, [rapierJoint, runtime, joint, template]);

  return <primitive object={jointRef} />;
}

function ArticulationControllers({
  blueprint,
  mode,
}: {
  blueprint: Blueprint;
  mode: "edit" | "simulate";
}) {
  const runtime = useAssemblyRuntime();
  const inputsRef = useRef({ forward: 0, turn: 0 });
  const hasVehicle = blueprint.root.metadata?.kind === "vehicle";

  useEffect(() => {
    if (!hasVehicle) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === "KeyW" || event.code === "ArrowUp") {
        inputsRef.current.forward = 1;
      }
      if (event.code === "KeyS" || event.code === "ArrowDown") {
        inputsRef.current.forward = -1;
      }
      if (event.code === "KeyA" || event.code === "ArrowLeft") {
        inputsRef.current.turn = -1;
      }
      if (event.code === "KeyD" || event.code === "ArrowRight") {
        inputsRef.current.turn = 1;
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === "KeyW" || event.code === "ArrowUp") {
        if (inputsRef.current.forward === 1) inputsRef.current.forward = 0;
      }
      if (event.code === "KeyS" || event.code === "ArrowDown") {
        if (inputsRef.current.forward === -1) inputsRef.current.forward = 0;
      }
      if (event.code === "KeyA" || event.code === "ArrowLeft") {
        if (inputsRef.current.turn === -1) inputsRef.current.turn = 0;
      }
      if (event.code === "KeyD" || event.code === "ArrowRight") {
        if (inputsRef.current.turn === 1) inputsRef.current.turn = 0;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [hasVehicle]);

  useFrame(() => {
    if (!hasVehicle || mode !== "simulate") return;
    const joints = Array.from(runtime.joints.values()).filter((entry) =>
      entry.instance.tags?.includes("drive"),
    );
    if (joints.length === 0) return;

    const { forward, turn } = inputsRef.current;
    const baseSpeed = 16;
    const turnStrength = 6;

    joints.forEach((entry) => {
      if (!("configureMotorVelocity" in entry.joint)) return;
      const isLeft = entry.instance.tags?.includes("left");
      const turnContribution = turn * (isLeft ? -turnStrength : turnStrength);
      const targetVelocity = forward * baseSpeed + turnContribution;
      const maxForce = entry.template.drive?.maxForce ?? 450;
      entry.joint.configureMotorVelocity(targetVelocity, maxForce);
    });
  });

  return null;
}

interface EditorTransformControlsProps {
  mode: "edit" | "simulate";
  transformMode: "translate" | "rotate";
  selectedPartId?: string | null;
  onTransformChange?: (id: string, transform: Transform) => void;
  orbitRef: React.RefObject<OrbitControlsImpl>;
}

function EditorTransformControls({
  mode,
  transformMode,
  selectedPartId,
  onTransformChange,
  orbitRef,
}: EditorTransformControlsProps) {
  const runtime = useAssemblyRuntime();
  const transformRef = useRef<TransformControlsImpl>(null);

  const selectedObject = useMemo(() => {
    if (!selectedPartId) return null;
    return runtime.bodies.get(selectedPartId)?.object ?? null;
  }, [runtime, selectedPartId, runtime.version]);

  useEffect(() => {
    const controls = transformRef.current;
    if (!controls) return;
    if (mode === "edit" && selectedObject) {
      controls.attach(selectedObject);
    } else {
      controls.detach();
    }
  }, [mode, selectedObject]);

  useEffect(() => {
    const controls = transformRef.current;
    const orbit = orbitRef.current;
    if (!controls || !orbit) return;
    const callback = (event: { value: boolean }) => {
      orbit.enabled = !event.value;
    };
    controls.addEventListener("dragging-changed", callback);
    return () => controls.removeEventListener("dragging-changed", callback);
  }, [orbitRef]);

  const handleObjectChange = useCallback(() => {
    const controls = transformRef.current;
    if (!controls || !controls.object || !selectedPartId || !onTransformChange)
      return;
    const object = controls.object as Group;
    onTransformChange(selectedPartId, {
      position: vectorToArray(object.position as Vector3),
      rotationQuat: quaternionToArray(object.quaternion as Quaternion),
    });
  }, [onTransformChange, selectedPartId]);

  return (
    <TransformControls
      ref={transformRef}
      enabled={mode === "edit" && !!selectedObject}
      mode={transformMode}
      onObjectChange={handleObjectChange}
    />
  );
}

function AssemblyRuntimeProvider({ children }: { children: React.ReactNode }) {
  const bodiesRef = useRef(new Map<string, RegisteredBody>());
  const jointsRef = useRef(new Map<string, RegisteredJoint>());
  const [version, setVersion] = useState(0);

  const bumpVersion = useCallback(() => {
    setVersion((value) => value + 1);
  }, []);

  const registerBody = useCallback(
    (entry: RegisteredBody) => {
      bodiesRef.current.set(entry.id, entry);
      bumpVersion();
    },
    [bumpVersion],
  );

  const unregisterBody = useCallback(
    (id: string) => {
      if (bodiesRef.current.delete(id)) {
        bumpVersion();
      }
    },
    [bumpVersion],
  );

  const registerJoint = useCallback(
    (entry: RegisteredJoint) => {
      jointsRef.current.set(entry.id, entry);
      bumpVersion();
    },
    [bumpVersion],
  );

  const unregisterJoint = useCallback(
    (id: string) => {
      if (jointsRef.current.delete(id)) {
        bumpVersion();
      }
    },
    [bumpVersion],
  );

  const contextValue = useMemo<AssemblyRuntimeContextValue>(
    () => ({
      bodies: bodiesRef.current,
      joints: jointsRef.current,
      registerBody,
      unregisterBody,
      registerJoint,
      unregisterJoint,
      version,
    }),
    [registerBody, registerJoint, unregisterBody, unregisterJoint, version],
  );

  return (
    <AssemblyRuntimeContext.Provider value={contextValue}>
      {children}
    </AssemblyRuntimeContext.Provider>
  );
}

function useSelectedObject(
  runtime: AssemblyRuntimeContextValue,
  selectedPartId?: string | null,
): Group | null {
  return useMemo(() => {
    if (!selectedPartId) return null;
    return runtime.bodies.get(selectedPartId)?.object ?? null;
  }, [runtime, selectedPartId, runtime.version]);
}

export function AssemblyCanvas({
  blueprint,
  catalog,
  mode,
  selectedPartId,
  onSelectPart,
  onTransformChange,
  transformMode,
  jointTargets,
}: AssemblyCanvasProps) {
  const physicsKey = `${mode}-${blueprint.id}`;
  const orbitRef = useRef<OrbitControlsImpl>(null);
  const handlePartSelect = useCallback(
    (id: string) => {
      onSelectPart?.(id);
    },
    [onSelectPart],
  );

  return (
    <div className="relative w-full h-full bg-gray-900 rounded-lg overflow-hidden">
      <Canvas
        shadows
        camera={{ position: [10, 8, 10], fov: 45 }}
        dpr={[1, 2]}
        onPointerMissed={() => onSelectPart?.(null)}
      >
        <color attach="background" args={["#0f172a"]} />
        <ambientLight intensity={0.5} />
        <directionalLight
          position={[8, 12, 6]}
          intensity={1.2}
          castShadow
          shadow-mapSize={[1024, 1024]}
        />
        <AssemblyRuntimeProvider>
          <Physics
            key={physicsKey}
            gravity={[0, mode === "simulate" ? -9.81 : 0, 0]}
            colliders={false}
          >
            <AssemblyBodies
              blueprint={blueprint}
              catalog={catalog}
              mode={mode}
              selectedPartId={selectedPartId}
              onSelectPart={handlePartSelect}
            />
            {blueprint.root.joints.map((joint) => {
              const template = catalog.jointTemplates?.[joint.template];
              if (!template) return null;
              return (
                <JointRenderer
                  key={joint.id}
                  joint={joint}
                  template={template}
                  blueprint={blueprint}
                  catalog={catalog}
                  jointTarget={jointTargets?.[joint.id]}
                />
              );
            })}
          </Physics>
          <ArticulationControllers blueprint={blueprint} mode={mode} />
          <EditorTransformControls
            mode={mode}
            transformMode={transformMode}
            selectedPartId={selectedPartId}
            onTransformChange={onTransformChange}
            orbitRef={orbitRef}
          />
        </AssemblyRuntimeProvider>
        <Grid
          args={[20, 20]}
          cellSize={1}
          cellThickness={0.5}
          sectionSize={5}
          sectionThickness={1}
          sectionColor="gray"
          cellColor="#2c3a56"
          fadeDistance={40}
          fadeStrength={1}
          position={[0, 0.01, 0]}
        />
        <OrbitControls ref={orbitRef} makeDefault maxPolarAngle={Math.PI / 2} />
      </Canvas>
    </div>
  );
}

export default AssemblyCanvas;
