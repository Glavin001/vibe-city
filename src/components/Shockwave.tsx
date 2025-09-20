import { useRef, useMemo, useEffect } from "react";
import { useBeforePhysicsStep, useRapier } from "@react-three/rapier";
import type * as THREE from "three";

// Minimal vector helpers (avoid creating garbage each frame)
const tmp = { x: 0, y: 0, z: 0 };

type ShockwaveProps = {
  /**
   * The 3D coordinates where the shockwave originates (explosion center).
   * Example: { x: 0, y: 1, z: 0 }
   */
  origin: { x: number; y: number; z: number };

  /**
   * The speed at which the shockwave front travels outward, in meters per second (m/s).
   * Typical outdoor explosions have speeds between 300 and 700 m/s.
   * Higher values make the shockwave expand faster.
   */
  speed?: number;

  /**
   * The thickness of the shockwave's active shell, in meters (ΔR).
   * This determines how "wide" the shockwave front is as it moves.
   * A larger value makes the shockwave affect more objects at once.
   * If not set, a suitable value is chosen automatically to ensure the shockwave does not skip over objects.
   */
  thickness?: number;

  /**
   * The maximum pressure (overpressure) at the center of the explosion, in Pascals.
   * This controls how strong the shockwave is at its origin.
   * Higher values result in a more powerful shockwave.
   * You can adjust this to make the effect more or less dramatic.
   */
  P0?: number;

  /**
   * The reference distance, in meters, used to determine how quickly the shockwave's strength decreases as it moves away from the origin.
   * Larger values make the shockwave's effects reach farther.
   */
  r0?: number;

  /**
   * The duration, in seconds, of the shockwave's initial (positive) pressure phase.
   * This is how long the main "push" of the shockwave lasts at each point it passes.
   * Typical values are around 0.04 seconds.
   */
  tauPos?: number;

  /**
   * The duration, in seconds, of the shockwave's negative (afterflow) phase.
   * After the main push, the air can briefly flow back toward the center; this controls how long that effect lasts.
   * Typical values are around 0.06 seconds.
   */
  tauNeg?: number;

  /**
   * The strength of the negative (afterflow) phase, as a fraction of the peak pressure (0 to 1).
   * A value of 0 means no afterflow; 1 means the afterflow is as strong as the initial push.
   * This controls how much "suction" follows the main shockwave.
   */
  afterflowScale?: number;

  /**
   * The maximum distance, in meters, that the shockwave will travel before stopping.
   * Once the shockwave front exceeds this distance from the origin, it will no longer affect objects.
   * Use this to limit the area of effect.
   */
  maxDistance?: number;

  /**
   * If true, the shockwave's strength is reduced for objects that are blocked by obstacles (using a raycast to check for occlusion).
   * This makes the shockwave more realistic by preventing it from passing through walls or other barriers.
   */
  occlusion?: boolean;

  /**
   * Optional callback function that is called when the shockwave has finished and is no longer active.
   * You can use this to trigger other effects or clean up resources.
   */
  onDone?: () => void;
};

type ShockwavePreset = Omit<ShockwaveProps, "origin" | "onDone">;

export const SHOCKWAVE_PRESETS = {
  GasBlast: {
    // origin: { x: 0, y: 1, z: 0 },
    speed: 380,             // m/s
    // thickness: 2,           // m  (bump to >= speed*dt)
    P0: 25_000,             // Pa ≈ 3.6 psi at r = r0
    r0: 6,                  // m
    tauPos: 0.03,           // s
    tauNeg: 0.05,           // s
    afterflowScale: 0.35,
    maxDistance: 120        // m (effects fade to negligible)
  },
  BuildingDestroyer: {
    // origin: { x: 0, y: 1, z: 0 },
    speed: 550,             // m/s
    // thickness: 3,           // m
    P0: 250_000,            // Pa ≈ 36 psi at r = r0 (collapse-capable near-field)
    r0: 8,                  // m
    tauPos: 0.04,           // s
    tauNeg: 0.06,           // s
    afterflowScale: 0.4,
    maxDistance: 180        // m
  },
  IndustrialLarge: {
    // origin: { x: 0, y: 1, z: 0 },
    speed: 650,             // m/s
    // thickness: 5,           // m
    P0: 300_000,            // Pa ≈ 44 psi at r = r0
    r0: 20,                 // m
    tauPos: 0.06,           // s
    tauNeg: 0.09,           // s
    afterflowScale: 0.5,
    maxDistance: 400        // m
  }
} satisfies Record<string, ShockwavePreset>;
// export type ShockwavePresetName = keyof typeof SHOCKWAVE_PRESETS;

/** Friedlander pulse p(τ) = p_s (1 - τ/τ+) e^{-τ/τ+}, 0<=τ<=τ+  */
function friedlander(peak: number, tau: number, tauPos: number) {
  if (tau < 0 || tau > tauPos) return 0;
  const s = tau / tauPos;
  return peak * (1 - s) * Math.exp(-s);
}

export function Shockwave({
  origin,
  speed = 420,
  thickness,               // will be auto-chosen below if omitted
  P0 = 5000,
  r0 = 1.0,
  tauPos = 0.04,
  tauNeg = 0.06,
  afterflowScale = 0.25,
  maxDistance = 200,
  occlusion = false,
  onDone,
}: ShockwaveProps) {

  console.log("Shockwave render");
  useEffect(() => {
    console.log("Shockwave mount");
    return () => {
      console.log("Shockwave unmount");
    };
  }, []);

  const { world, rapier } = useRapier();

  // Use the physics dt so expansion speed matches the simulation step. :contentReference[oaicite:1]{index=1}
  const dt = world.integrationParameters.dt;

  // If caller didn’t pick a thickness, choose one that guarantees
  // the shell moves less than its own thickness per step.
  const dR = useMemo(() => thickness ?? Math.max(0.5, speed * dt * 1.5), [thickness, speed, dt]);

  // Per-body arrival time (seconds since explosion start), keyed by handle
  const arrival = useRef(new Map<number, number>());
  // Time since start (sim-time), and whether we’re finished
  const t = useRef(0);
  const done = useRef(false);

  // Visuals: outer translucent shell, outer wire (Rmax), inner wire (Rmin)
  const outerRef = useRef<THREE.Mesh | null>(null);
  const frontRef = useRef<THREE.Mesh | null>(null);
  const innerWireRef = useRef<THREE.Mesh | null>(null);

  useBeforePhysicsStep(() => {
    if (done.current) return;

    t.current += dt;
    const R = speed * t.current;
    const Rmin = Math.max(0, R - dR * 0.5);
    const Rmax = R + dR * 0.5;

    // Update visuals
    if (outerRef.current) {
      const s = Math.max(0.001, Rmax);
      outerRef.current.scale.set(s, s, s);
      outerRef.current.visible = true;
    }
    if (frontRef.current) {
      const s = Math.max(0.001, Rmax);
      frontRef.current.scale.set(s, s, s);
      frontRef.current.visible = true;
    }
    if (innerWireRef.current) {
      const s = Math.max(0.001, Rmin);
      innerWireRef.current.scale.set(s, s, s);
      innerWireRef.current.visible = true;
    }

    // Iterate all rigid bodies in the world efficiently. :contentReference[oaicite:2]{index=2}
    world.bodies.forEach((rb) => {
    //   if (rb.isFixed() || rb.isSleeping()) return;
      if (rb.isFixed()) return;

      const p = rb.translation();
      const dx = p.x - origin.x, dy = p.y - origin.y, dz = p.z - origin.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < 1e-6) return; // co-located; skip to avoid NaNs

      // If this body just entered the thin shell, mark its arrival time
      if (!arrival.current.has(rb.handle) && d >= Rmin && d <= Rmax) {
        arrival.current.set(rb.handle, t.current);
      }

      // If we’ve recorded an arrival, compute time-since-arrival and apply forces
      const tArr = arrival.current.get(rb.handle);
      if (tArr === undefined) return;

      const tau = t.current - tArr;
      // Distance falloff ~ inverse-square (tweak/clamp as desired)
      const pPeak = P0 * (r0 / (d + 0.5)) ** 2;

      let pNow = 0;
      if (tau <= tauPos) {
        pNow = friedlander(pPeak, tau, tauPos); // positive phase
      } else if (tau <= tauPos + tauNeg) {
        // simple linear tail-off for the afterflow (“blast wind”)
        // negative phase (suction) opposes the positive phase
        const s = (tau - tauPos) / tauNeg;
        pNow = -afterflowScale * pPeak * Math.max(0, 1 - s);
      } else {
        // finished affecting this body
        arrival.current.delete(rb.handle);
        return;
      }

      // Optional occlusion: cast ray from origin to body; if hit something else first, attenuate. :contentReference[oaicite:3]{index=3}
      let occ = 1.0;
      if (occlusion) {
        const dir = { x: dx / d, y: dy / d, z: dz / d };
        const ray = new rapier.Ray(origin, dir);
        const hit = world.castRay(ray, d - 0.01, true);
        if (hit) {
          const h = hit as unknown as { toi?: number; timeOfImpact?: number };
          const toi = h.toi ?? h.timeOfImpact ?? Number.POSITIVE_INFINITY;
          if (toi < d - 0.01) {
          // crude attenuation based on how “blocked” it is
            occ = 0.3; // tune or compute from material/filter if you want
          }
        }
      }

      // Force direction (radial)
      const pushMagnitude = pNow * occ;
      const minPushMagnitude = 1;
      if (Math.abs(pushMagnitude) <= minPushMagnitude) {
        return;
      }

      tmp.x = (dx / d) * pushMagnitude;
      tmp.y = (dy / d) * pushMagnitude;
      tmp.z = (dz / d) * pushMagnitude;

      // Apply *continuous* force this step. (Use addForceAtPoint if you want spin.) :contentReference[oaicite:4]{index=4}
      //   rb.wakeUp();
      //   rb.addForce(tmp, true);
      // Example for spinny kicks instead:
      rb.addForceAtPoint(tmp, p, true); // world-space point at body’s COM

      // console.log("addForce", tmp, p);
    });

    // Stop the component when the front has traveled far enough
    if (R > maxDistance && arrival.current.size === 0) {
      console.log("Shockwave done");
      done.current = true;
      onDone?.();
    }
  });

  return (
    <group position={[origin.x, origin.y, origin.z]}>
      {/* Outer translucent shell (Rmax) */}
      <mesh ref={outerRef} visible={false}>
        <sphereGeometry args={[1, 48, 32]} />
        <meshBasicMaterial color="#66ccff" transparent opacity={0.08} depthWrite={false} />
      </mesh>
      {/* Outer boundary wireframe (Rmax) */}
      <mesh ref={frontRef} visible={false}>
        <sphereGeometry args={[1, 32, 24]} />
        <meshBasicMaterial color="#9ad8ff" wireframe transparent opacity={0.6} />
      </mesh>
      {/* Inner boundary wireframe (Rmin) */}
      <mesh ref={innerWireRef} visible={false}>
        <sphereGeometry args={[1, 24, 18]} />
        <meshBasicMaterial color="#88cfff" wireframe transparent opacity={0.45} />
      </mesh>
    </group>
  );
}
