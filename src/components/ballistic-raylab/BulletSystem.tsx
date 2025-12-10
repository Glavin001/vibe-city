"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import type { BulletTrace } from "@/lib/ballistic-raylab/types";
import type * as THREE from "three";

interface BulletSystemProps {
  traces: BulletTrace[];
}

export const BulletSystem: React.FC<BulletSystemProps> = ({ traces }) => {
  return (
    <group>
      {traces.map((trace) => (
        <BulletTraceVisual key={trace.id} trace={trace} />
      ))}
    </group>
  );
};

const BulletTraceVisual: React.FC<{ trace: BulletTrace }> = ({ trace }) => {
  // Fade out logic
  const materialRef = useRef<THREE.LineBasicMaterial>(null);

  useFrame((state) => {
    if (materialRef.current) {
      const age = state.clock.elapsedTime * 1000 - trace.timestamp;
      const life = 3000; // 3 seconds visible
      const opacity = Math.max(0, 1 - age / life);
      materialRef.current.opacity = opacity;
      materialRef.current.transparent = true;
    }
  });

  return (
    <group>
      {trace.segments.map((seg, i) => {
        let color = "yellow"; // Air
        if (seg.type === "penetration") color = "red"; // Slowed/Heat
        if (seg.type === "ricochet") color = "cyan"; // Bounce

        return (
          <Line
            key={`${trace.id}-${i}`}
            points={[seg.start, seg.end]}
            color={color}
            lineWidth={2}
            ref={materialRef}
            raycast={() => null} // CRITICAL FIX: Disable raycasting to prevent crash
          />
        );
      })}
    </group>
  );
};



