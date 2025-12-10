"use client";

import React, { useRef, useEffect } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import { Vector3, Euler } from "three";
import { PointerLockControls } from "@react-three/drei";

interface PlayerProps {
  onShoot: (origin: Vector3, direction: Vector3) => void;
  isMobile: boolean;
  moveInput: React.MutableRefObject<{ x: number; y: number }>; // Receive Ref
  lookInput: React.MutableRefObject<{ x: number; y: number }>; // Receive Ref
  shootTrigger: number;
}

// Extract and Memoize controls to prevent unmounting/remounting when Player props (like shootTrigger) change.
// This prevents the "user exited lock" error caused by rapid re-renders.
const DesktopControls = React.memo(() => {
  return <PointerLockControls makeDefault />;
});

export const Player: React.FC<PlayerProps> = ({
  onShoot,
  isMobile,
  moveInput,
  lookInput,
  shootTrigger,
}) => {
  const { camera } = useThree();

  // Track previous shoot trigger to detect click
  const prevShootTrigger = useRef(0);

  // Mobile look state
  const euler = useRef(new Euler(0, 0, 0, "YXZ"));

  // Movement settings
  const speed = 4.0; // Slower for house navigation

  useEffect(() => {
    // Initial camera height & position (Outside front door)
    camera.position.set(0, 1.6, 10);
    euler.current.setFromQuaternion(camera.quaternion);
  }, [camera]);

  useEffect(() => {
    if (shootTrigger > prevShootTrigger.current) {
      // Fire!
      const direction = new Vector3();
      camera.getWorldDirection(direction);

      // Shoot directly from camera center (Standard FPS raycast behavior)
      const origin = camera.position.clone();

      onShoot(origin, direction);
      prevShootTrigger.current = shootTrigger;
    }
  }, [shootTrigger, onShoot, camera]);

  useFrame(() => {
    // 1. ROTATION
    if (isMobile) {
      // Apply look input to euler angles
      // lookInput provides delta since last frame/event
      const lx = lookInput.current.x;
      const ly = lookInput.current.y;

      if (lx !== 0 || ly !== 0) {
        const sens = 1.5;

        // Horizontal: Drag Right -> lx > 0 -> euler.y decreases -> Look Right (Negative Rotation around Y)
        euler.current.y -= lx * sens;

        // Vertical: Drag Down -> ly > 0 -> euler.x decreases -> Look Down (Negative Rotation around X)
        // (Previously was += which caused Look Up)
        euler.current.x -= ly * sens;

        // Clamp look up/down
        euler.current.x = Math.max(
          -Math.PI / 2 + 0.1,
          Math.min(Math.PI / 2 - 0.1, euler.current.x)
        );

        camera.quaternion.setFromEuler(euler.current);

        // Reset input after processing
        lookInput.current.x = 0;
        lookInput.current.y = 0;
      }
    }
    // PointerLock handles rotation automatically when locked (desktop)

    // 2. MOVEMENT
    // Calculate relative directions
    const forward = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    forward.y = 0;
    forward.normalize();

    const side = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    side.y = 0;
    side.normalize();

    // Actual movement vector accumulation
    const finalMove = new Vector3();

    if (isMobile) {
      // Joystick input - Read from current ref
      const mx = moveInput.current.x;
      const my = moveInput.current.y;

      finalMove.add(side.multiplyScalar(mx));
      finalMove.add(forward.multiplyScalar(my)); // Joystick up is positive Y
    }

    if (finalMove.length() > 0) {
      const delta = 0.016; // approx 60fps
      camera.position.add(finalMove.normalize().multiplyScalar(speed * delta));
    }
  });

  // Desktop Keyboard Movement logic hook
  useEffect(() => {
    if (isMobile) return;

    const keys = { w: false, a: false, s: false, d: false };
    const onKeyDown = (e: KeyboardEvent) => {
      switch (e.key.toLowerCase()) {
        case "w":
          keys.w = true;
          break;
        case "a":
          keys.a = true;
          break;
        case "s":
          keys.s = true;
          break;
        case "d":
          keys.d = true;
          break;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      switch (e.key.toLowerCase()) {
        case "w":
          keys.w = false;
          break;
        case "a":
          keys.a = false;
          break;
        case "s":
          keys.s = false;
          break;
        case "d":
          keys.d = false;
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    // Animation frame loop for keyboard specifically
    let animationId: number;
    const update = () => {
      const delta = 0.016; // approx
      const forward = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      forward.y = 0;
      forward.normalize();
      const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      right.y = 0;
      right.normalize();

      const move = new Vector3();
      if (keys.w) move.add(forward);
      if (keys.s) move.sub(forward);
      if (keys.d) move.add(right);
      if (keys.a) move.sub(right);

      if (move.length() > 0) move.normalize().multiplyScalar(speed * delta);
      camera.position.add(move);

      animationId = requestAnimationFrame(update);
    };
    update();

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      cancelAnimationFrame(animationId);
    };
  }, [isMobile, camera, speed]);

  return <>{!isMobile && <DesktopControls />}</>;
};



