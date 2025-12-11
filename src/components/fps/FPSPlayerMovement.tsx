"use client";

import RAPIER from "@dimforge/rapier3d-compat";
import { useKeyboardControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";

// Keyboard control names for FPS movement
export type FPSControlsName = "forward" | "backward" | "left" | "right" | "jump" | "descend";

// Player constants
export const PLAYER_EYE_HEIGHT = 1.65;
export const PLAYER_WALK_SPEED = 5;
export const PLAYER_RUN_SPEED = 9;
export const PLAYER_CAPSULE_HALF_HEIGHT = 0.6;
export const PLAYER_CAPSULE_RADIUS = 0.3;
export const PLAYER_CAPSULE_CENTER_HEIGHT = PLAYER_CAPSULE_HALF_HEIGHT + PLAYER_CAPSULE_RADIUS;
export const PLAYER_GRAVITY = -30;
export const PLAYER_JUMP_VELOCITY = 8.5;
export const PLAYER_FALLBACK_VERTICAL_SPEED = 6; // Jetpack speed for fallback mode

// Reusable vectors for player movement (avoid allocations per frame)
const _playerForward = new THREE.Vector3();
const _playerRight = new THREE.Vector3();
const _playerDir = new THREE.Vector3();
const _playerUp = new THREE.Vector3(0, 1, 0);

/**
 * FPS Player Movement with Rapier Kinematic Character Controller
 * 
 * Features:
 * - WASD camera-relative movement
 * - Jetpack-style jump (hold space to fly)
 * - Shift to run
 * - Physics-based collision with Rapier KCC when world is available
 * - Fallback simple movement when physics world is not ready
 * 
 * Note: PointerLockControls should be rendered separately to persist across scene resets
 */
export type FPSPlayerMovementProps = {
  /** Rapier physics world (pass null when not ready) */
  world: RAPIER.World | null;
  /** Spawn position [x, y, z] */
  spawn: [number, number, number];
  /** Player capsule half-height (default: 0.6) */
  capsuleHalfHeight?: number;
  /** Player capsule radius (default: 0.3) */
  capsuleRadius?: number;
  /** Eye height above ground (default: 1.65) */
  eyeHeight?: number;
  /** Walk speed in m/s (default: 5) */
  walkSpeed?: number;
  /** Run speed in m/s (default: 9) */
  runSpeed?: number;
  /** Gravity in m/s² (default: -30) */
  gravity?: number;
  /** Jump/jetpack velocity in m/s (default: 8.5) */
  jumpVelocity?: number;
};

export function FPSPlayerMovement({
  world,
  spawn,
  capsuleHalfHeight = PLAYER_CAPSULE_HALF_HEIGHT,
  capsuleRadius = PLAYER_CAPSULE_RADIUS,
  eyeHeight = PLAYER_EYE_HEIGHT,
  walkSpeed = PLAYER_WALK_SPEED,
  runSpeed = PLAYER_RUN_SPEED,
  gravity = PLAYER_GRAVITY,
  jumpVelocity = PLAYER_JUMP_VELOCITY,
}: FPSPlayerMovementProps) {
  const camera = useThree((state) => state.camera);
  const [, get] = useKeyboardControls<FPSControlsName>();

  // Computed capsule center height
  const capsuleCenterHeight = capsuleHalfHeight + capsuleRadius;

  // Refs for Rapier objects
  const bodyRef = useRef<RAPIER.RigidBody | null>(null);
  const colliderRef = useRef<RAPIER.Collider | null>(null);
  const controllerRef = useRef<RAPIER.KinematicCharacterController | null>(null);
  const velocityYRef = useRef(0);
  const worldRef = useRef<RAPIER.World | null>(null);
  const initializedRef = useRef(false);
  
  // Store spawn in ref to avoid dependency issues (only used for initial position)
  const spawnRef = useRef(spawn);
  spawnRef.current = spawn;

  // Initialize player body and controller when world changes
  useEffect(() => {
    // Cleanup old physics objects if world changed
    if (worldRef.current && worldRef.current !== world) {
      if (controllerRef.current) {
        try { worldRef.current.removeCharacterController(controllerRef.current); } catch {}
        controllerRef.current = null;
      }
      if (bodyRef.current) {
        try { worldRef.current.removeRigidBody(bodyRef.current); } catch {}
        bodyRef.current = null;
      }
      colliderRef.current = null;
      initializedRef.current = false;
    }
    
    worldRef.current = world;
    
    if (!world) return;

    // Determine start position: use current camera position if already playing, otherwise spawn
    const useCurrentPosition = initializedRef.current;
    const startX = useCurrentPosition ? camera.position.x : spawnRef.current[0];
    const startY = useCurrentPosition 
      ? camera.position.y - (eyeHeight - capsuleCenterHeight) 
      : spawnRef.current[1];
    const startZ = useCurrentPosition ? camera.position.z : spawnRef.current[2];

    // Create kinematic rigid body
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(startX, startY, startZ);
    const body = world.createRigidBody(bodyDesc);

    // Create capsule collider
    const colliderDesc = RAPIER.ColliderDesc.capsule(capsuleHalfHeight, capsuleRadius);
    const collider = world.createCollider(colliderDesc, body);

    // Create character controller
    const controller = world.createCharacterController(0.1);
    controller.enableAutostep(0.7, 0.3, true);
    controller.enableSnapToGround(0.1);
    controller.setApplyImpulsesToDynamicBodies(true);

    bodyRef.current = body;
    colliderRef.current = collider;
    controllerRef.current = controller;

    // Only set camera position on first initialization
    if (!initializedRef.current) {
      camera.position.set(startX, startY + (eyeHeight - capsuleCenterHeight), startZ);
      initializedRef.current = true;
    }

    return () => {
      if (controllerRef.current && world) {
        try { world.removeCharacterController(controllerRef.current); } catch {}
        controllerRef.current = null;
      }
      if (bodyRef.current && world) {
        try { world.removeRigidBody(bodyRef.current); } catch {}
        bodyRef.current = null;
      }
      colliderRef.current = null;
    };
  }, [world, camera, capsuleHalfHeight, capsuleRadius, eyeHeight, capsuleCenterHeight]);

  useFrame((_, delta) => {
    const body = bodyRef.current;
    const collider = colliderRef.current;
    const ctrl = controllerRef.current;
    
    const { forward, backward, left, right, jump, descend } = get();
    const isRunning = descend; // Shift is run

    // Camera-relative planar movement (ignore pitch)
    camera.getWorldDirection(_playerForward);
    _playerForward.y = 0;
    if (_playerForward.lengthSq() > 0) _playerForward.normalize();
    _playerRight.copy(_playerForward).cross(_playerUp).normalize();

    const f = Number(forward) - Number(backward);
    const r = Number(right) - Number(left);
    _playerDir.set(0, 0, 0);
    if (f !== 0) _playerDir.addScaledVector(_playerForward, f);
    if (r !== 0) _playerDir.addScaledVector(_playerRight, r);
    if (_playerDir.lengthSq() > 1) _playerDir.normalize();

    // If physics KCC is available, use it for movement with collision
    if (body && collider && ctrl) {
      const speed = isRunning ? runSpeed : walkSpeed;
      
      // Gravity and jetpack-style jump (hold space to fly)
      const grounded = ctrl.computedGrounded();
      if (grounded && !jump) {
        velocityYRef.current = 0;
      } else {
        velocityYRef.current += gravity * delta;
      }
      
      // Jetpack: holding space applies constant upward thrust
      if (jump) {
        velocityYRef.current = jumpVelocity;
      }

      const movement = {
        x: _playerDir.x * speed * delta,
        y: velocityYRef.current * delta,
        z: _playerDir.z * speed * delta,
      };

      ctrl.computeColliderMovement(collider, movement);
      const translation = body.translation();
      const move = ctrl.computedMovement();

      const next = {
        x: translation.x + move.x,
        y: translation.y + move.y,
        z: translation.z + move.z,
      };
      body.setNextKinematicTranslation(next);

      camera.position.set(next.x, next.y + (eyeHeight - capsuleCenterHeight), next.z);
    } else {
      // Fallback: simple camera movement without physics (during loading)
      const speed = (isRunning ? runSpeed : walkSpeed) * delta;
      const verticalSpeed = PLAYER_FALLBACK_VERTICAL_SPEED * delta;
      
      camera.position.addScaledVector(_playerForward, f * speed);
      camera.position.addScaledVector(_playerRight, r * speed);
      
      // Jetpack vertical
      const verticalMove = Number(jump) - Number(descend);
      if (verticalMove !== 0) camera.position.y += verticalMove * verticalSpeed;
      
      // Clamp minimum height
      if (camera.position.y < eyeHeight) {
        camera.position.y = eyeHeight;
      }
    }
  });

  return null;
}

/**
 * Camera-attached point light for FPS mode (headlamp effect)
 */
export function CameraLight({
  intensity = 1.5,
  distance = 50,
  decay = 2,
  color = "#ffffff",
}: {
  intensity?: number;
  distance?: number;
  decay?: number;
  color?: string;
}) {
  const lightRef = useRef<THREE.PointLight>(null);
  const camera = useThree((state) => state.camera);

  useFrame(() => {
    if (lightRef.current) {
      lightRef.current.position.copy(camera.position);
    }
  });

  return (
    <pointLight
      ref={lightRef}
      intensity={intensity}
      distance={distance}
      decay={decay}
      color={color}
    />
  );
}

/**
 * Default keyboard mapping for FPS controls
 * Use with KeyboardControls from @react-three/drei
 */
export const FPS_KEYBOARD_MAP: { name: FPSControlsName; keys: string[] }[] = [
  { name: "forward", keys: ["ArrowUp", "w", "W"] },
  { name: "backward", keys: ["ArrowDown", "s", "S"] },
  { name: "left", keys: ["ArrowLeft", "a", "A"] },
  { name: "right", keys: ["ArrowRight", "d", "D"] },
  { name: "jump", keys: ["Space"] },
  { name: "descend", keys: ["ShiftLeft", "ShiftRight"] },
];
