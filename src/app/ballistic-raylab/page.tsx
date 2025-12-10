"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import type { RapierRigidBody } from "@react-three/rapier";
import { Vector3, type Scene } from "three";
import { SceneEnvironment } from "@/components/ballistic-raylab/Environment";
import { Player } from "@/components/ballistic-raylab/Player";
import { calculateBulletPath } from "@/lib/ballistic-raylab/ballisticsService";
import { BulletSystem } from "@/components/ballistic-raylab/BulletSystem";
import { UI } from "@/components/ballistic-raylab/UI";
import type { BulletTrace } from "@/lib/ballistic-raylab/types";

export default function BallisticRaylabPage() {
  const [isMobile, setIsMobile] = useState(false);
  const [bulletTraces, setBulletTraces] = useState<BulletTrace[]>([]);
  const [infiniteEnergy, setInfiniteEnergy] = useState(false);

  // Physics Body Registry for applying impulses
  const rigidBodyRefs = useRef<Record<string, RapierRigidBody>>({});

  const moveInput = useRef({ x: 0, y: 0 });
  const lookInput = useRef({ x: 0, y: 0 });

  const [shootTrigger, setShootTrigger] = useState(0);
  const fireInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const sceneRef = useRef<Scene | null>(null);

  // Register a body so we can shoot it later
  const registerBody = useCallback((uuid: string, api: RapierRigidBody) => {
    rigidBodyRefs.current[uuid] = api;
  }, []);

  // Use a key to reset the physics world when requested
  const [sceneKey, setSceneKey] = useState(0);

  useEffect(() => {
    const checkMobile = () => {
      const userAgent =
        typeof navigator === "undefined" ? "" : navigator.userAgent;
      const isTouch =
        "ontouchstart" in window || navigator.maxTouchPoints > 0;
      const isMobileDevice =
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
          userAgent
        );

      setIsMobile(isTouch || isMobileDevice);
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    return () => {
      if (fireInterval.current) clearInterval(fireInterval.current);
    };
  }, []);

  const startFiring = useCallback(() => {
    if (fireInterval.current) return;
    setShootTrigger((prev) => prev + 1);
    fireInterval.current = setInterval(() => {
      setShootTrigger((prev) => prev + 1);
    }, 100);
  }, []);

  const stopFiring = useCallback(() => {
    if (fireInterval.current) {
      clearInterval(fireInterval.current);
      fireInterval.current = null;
    }
  }, []);

  const handleShoot = useCallback(
    (origin: Vector3, direction: Vector3) => {
      if (!sceneRef.current) return;

      // 1. Calculate Ballistics (Raycasting against visual meshes)
      // Pass infiniteEnergy flag to disable loss if needed
      const segments = calculateBulletPath(
        origin,
        direction,
        sceneRef.current,
        1000,
        !infiniteEnergy
      );

      // 2. Add Visual Trace
      const newTrace: BulletTrace = {
        id: Date.now() + Math.random(),
        segments,
        timestamp: performance.now(),
      };
      setBulletTraces((prev) => [...prev.slice(-80), newTrace]);

      // 3. Apply Physics Impulses to Hit Objects
      // Check the end of each segment for a hit
      for (const seg of segments) {
        if (seg.hitObjectUUID && rigidBodyRefs.current[seg.hitObjectUUID]) {
          const bodyApi = rigidBodyRefs.current[seg.hitObjectUUID];

          // Calculate Impulse
          // FORCE FIX: Use the direction of the *segment*, not the initial camera direction.
          // This ensures deflected bullets push objects in the correct direction.
          // We use the explicit direction stored in the segment which is robust for short segments.
          const segmentVector = seg.direction.clone().normalize();

          // With infinite energy, seg.energyAtStart is always 1000.
          // We cap impulse to avoid crazy physics explosions, but ensure it's punchy.
          // Increased multipliers to make sure things MOVE.
          const baseForce = infiniteEnergy
            ? 40
            : Math.max(seg.energyAtStart * 0.4, 10);
          const impulseStrength = Math.min(baseForce, 100);
          const impulse = segmentVector.multiplyScalar(impulseStrength);

          // Wake up the body (true)
          bodyApi.applyImpulseAtPoint(impulse, seg.end, true);
        }
      }
    },
    [infiniteEnergy]
  );

  const handleJoystickMove = (x: number, y: number) => {
    moveInput.current.x = x;
    moveInput.current.y = y;
  };

  const handleResetPhysics = () => {
    rigidBodyRefs.current = {}; // Clear registry
    setBulletTraces([]); // Clear lines
    setSceneKey((prev) => prev + 1); // Remount scene
  };

  return (
    <div className="relative w-full h-screen bg-black">
      <UI
        isMobile={isMobile}
        onSetMobile={setIsMobile}
        onJoystickMove={handleJoystickMove}
        onLookDrag={(x, y) => {
          lookInput.current.x += x;
          lookInput.current.y += y;
        }}
        onFireStart={startFiring}
        onFireEnd={stopFiring}
        onClearTraces={handleResetPhysics}
        infiniteEnergy={infiniteEnergy}
        onToggleEnergy={() => setInfiniteEnergy(!infiniteEnergy)}
      />

      <Canvas
        shadows
        onCreated={({ scene }) => {
          sceneRef.current = scene;
        }}
        camera={{ fov: 75, near: 0.1, far: 1000 }}
        onPointerDown={() => {
          if (!isMobile) startFiring();
        }}
        onPointerUp={() => {
          if (!isMobile) stopFiring();
        }}
        onPointerLeave={() => {
          if (!isMobile) stopFiring();
        }}
      >
        <color attach="background" args={["#111"]} />
        <fog attach="fog" args={["#111", 10, 50]} />

        {/* Physics World - Gravity enabled */}
        <Physics gravity={[0, -9.81, 0]} key={sceneKey}>
          <SceneEnvironment registerBody={registerBody} />
        </Physics>

        <BulletSystem traces={bulletTraces} />

        <Player
          onShoot={handleShoot}
          isMobile={isMobile}
          moveInput={moveInput}
          lookInput={lookInput}
          shootTrigger={shootTrigger}
        />
      </Canvas>
    </div>
  );
}



