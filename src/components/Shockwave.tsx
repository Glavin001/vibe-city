import { useRef, useMemo, useEffect } from "react";
import { useBeforePhysicsStep, useRapier } from "@react-three/rapier";
import type * as THREE from "three";

// Minimal vector helpers (avoid creating garbage each frame)
const tmp = { x: 0, y: 0, z: 0 };

const TNT_ENERGY_J_PER_KG = 4.184e6;

type BurstType = "freeAir" | "surface";

type ExplosionSpec =
  | { type: "tnt"; tntKg: number; burst?: BurstType }
  | { type: "he"; massKg: number; equivalency?: number; burst?: BurstType }
  | { type: "energy"; joules: number; burst?: BurstType };

type ShockwaveProps = {
  /** Origin of the blast */
  origin: { x: number; y: number; z: number };
  /** What exploded; we derive peak overpressure and durations from this */
  explosion: ExplosionSpec;
  /** Front propagation speed (visual/arrival timing), m/s */
  frontSpeed?: number;
  /** Shell thickness (auto if omitted) */
  thickness?: number;
  /** Negative-phase suction scale (0..1) */
  afterflowScale?: number;
  /** Optional explicit cutoff distance */
  maxDistance?: number;
  /** Simple occlusion via ray test */
  occlusion?: boolean;
  /** Pressure->force conversion factor (approximates exposed area), N/Pa */
  forceScale?: number;
  /** Called when finished */
  onDone?: () => void;
};

type ShockwavePreset = Omit<ShockwaveProps, "origin" | "onDone">;

export const SHOCKWAVE_PRESETS = {
  Small: {
    explosion: { type: "tnt", tntKg: 0.01, burst: "surface" },
    frontSpeed: 420,
    afterflowScale: 0.3,
    forceScale: 0.01,
  },
  Grenade_M67: {
    explosion: { type: "he", massKg: 0.18, equivalency: 1.25, burst: "surface" },
    frontSpeed: 420,
    afterflowScale: 0.3,
    forceScale: 0.01,
  },
  TNT_5kg_Surface: {
    explosion: { type: "tnt", tntKg: 5, burst: "surface" },
    frontSpeed: 450,
    afterflowScale: 0.35,
    forceScale: 0.02,
  },
  C4_2kg_Surface: {
    explosion: { type: "he", massKg: 2, equivalency: 1.34, burst: "surface" },
    frontSpeed: 450,
    afterflowScale: 0.4,
    forceScale: 0.018,
  },
  CarBomb_100kg_Surface: {
    explosion: { type: "tnt", tntKg: 100, burst: "surface" },
    frontSpeed: 480,
    afterflowScale: 0.35,
    forceScale: 0.06,
  },
  Rocket_HE_3kg_Free: {
    explosion: { type: "he", massKg: 3, equivalency: 1.1, burst: "freeAir" },
    frontSpeed: 520,
    afterflowScale: 0.35,
    forceScale: 0.018,
  },
  Meteor_1GJ_Airburst: {
    explosion: { type: "energy", joules: 1e9, burst: "freeAir" },
    frontSpeed: 340,
    afterflowScale: 0.3,
    forceScale: 0.08,
  },
} satisfies Record<string, ShockwavePreset>;
// export type ShockwavePresetName = keyof typeof SHOCKWAVE_PRESETS;

// Lightweight Kingery–Bulmash style table (free-air). Values are approximate.
// Columns: Z (m/kg^{1/3}), P_peak (kPa), tPlus_per_cuberoot (ms per kg^{1/3})
const KB_TABLE_FREE_AIR: ReadonlyArray<{ Z: number; PkPa: number; tPlusMsPerCuberoot: number }> = [
  { Z: 0.20, PkPa: 800, tPlusMsPerCuberoot: 2.0 },
  { Z: 0.30, PkPa: 450, tPlusMsPerCuberoot: 3.0 },
  { Z: 0.50, PkPa: 170, tPlusMsPerCuberoot: 5.0 },
  { Z: 0.70, PkPa: 110, tPlusMsPerCuberoot: 6.5 },
  { Z: 1.00, PkPa: 70, tPlusMsPerCuberoot: 8.0 },
  { Z: 1.50, PkPa: 35, tPlusMsPerCuberoot: 12.0 },
  { Z: 2.00, PkPa: 22, tPlusMsPerCuberoot: 16.0 },
  { Z: 3.00, PkPa: 12, tPlusMsPerCuberoot: 25.0 },
  { Z: 5.00, PkPa: 6, tPlusMsPerCuberoot: 40.0 },
  { Z: 10.00, PkPa: 2, tPlusMsPerCuberoot: 80.0 },
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function logInterp(x: number, x0: number, y0: number, x1: number, y1: number): number {
  const lx = Math.log(x);
  const lx0 = Math.log(x0);
  const lx1 = Math.log(x1);
  const ly0 = Math.log(y0);
  const ly1 = Math.log(y1);
  const t = clamp((lx - lx0) / (lx1 - lx0), 0, 1);
  const ly = ly0 + t * (ly1 - ly0);
  return Math.exp(ly);
}

function kbLookupFreeAir(Z: number): { pPeakPa: number; tPlusSPerCuberoot: number } {
  const table = KB_TABLE_FREE_AIR;
  const Zc = clamp(Z, table[0].Z, table[table.length - 1].Z);
  let i = 0;
  for (; i < table.length - 1; i += 1) {
    if (Zc <= table[i + 1].Z) break;
  }
  const a = table[i];
  const b = table[Math.min(i + 1, table.length - 1)];
  const PkPa = logInterp(Zc, a.Z, a.PkPa, b.Z, b.PkPa);
  const tMsPerCuberoot = logInterp(Zc, a.Z, a.tPlusMsPerCuberoot, b.Z, b.tPlusMsPerCuberoot);
  return { pPeakPa: PkPa * 1000, tPlusSPerCuberoot: tMsPerCuberoot * 1e-3 };
}

function reflectionFactorSurface(Z: number): number {
  if (Z <= 1) return 2.0;
  if (Z >= 10) return 1.0;
  const t = (Z - 1) / 9;
  return 2.0 - t * 1.0;
}

function tntEquivalentKg(spec: ExplosionSpec): { Wkg: number; burst: BurstType } {
  const burst = spec.burst ?? "surface";
  switch (spec.type) {
    case "tnt":
      return { Wkg: Math.max(1e-6, spec.tntKg), burst };
    case "he": {
      const eq = spec.equivalency ?? 1.0;
      return { Wkg: Math.max(1e-6, spec.massKg * eq), burst };
    }
    case "energy":
      return { Wkg: Math.max(1e-6, spec.joules / TNT_ENERGY_J_PER_KG), burst };
  }
}

/** Friedlander pulse p(τ) = p_s (1 - τ/τ+) e^{-τ/τ+}, 0<=τ<=τ+  */
function friedlander(peak: number, tau: number, tauPos: number) {
  if (tau < 0 || tau > tauPos) return 0;
  const s = tau / tauPos;
  return peak * (1 - s) * Math.exp(-s);
}

export function Shockwave({
  origin,
  explosion,
  frontSpeed = 420,
  thickness,               // will be auto-chosen below if omitted
  afterflowScale = 0.35,
  maxDistance,
  occlusion = false,
  forceScale = 0.05,
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
  const dR = useMemo(() => thickness ?? Math.max(0.5, frontSpeed * dt * 1.5), [thickness, frontSpeed, dt]);

  const { Wkg, burst } = useMemo(() => tntEquivalentKg(explosion), [explosion]);
  const derivedMaxDistance = useMemo(() => {
    // Stop when free-air peak overpressure decays below ~0.5 kPa
    const Zstop = 20;
    return Zstop * Math.cbrt(Wkg);
  }, [Wkg]);

  // Per-body record
  const arrival = useRef(new Map<number, { tArr: number; pPeakPa: number; tPlus: number; tMinus: number }>());
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
    const R = frontSpeed * t.current;
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

      // If this body just entered the thin shell, mark and derive per-body params
      if (!arrival.current.has(rb.handle) && d >= Rmin && d <= Rmax) {
        const Z = d / Math.cbrt(Wkg);
        const { pPeakPa: p0, tPlusSPerCuberoot } = kbLookupFreeAir(Z);
        const refl = burst === "surface" ? reflectionFactorSurface(Z) : 1.0;
        const pPeakPa = p0 * refl;
        const tPlus = tPlusSPerCuberoot * Math.cbrt(Wkg);
        const tMinus = tPlus * 1.5;
        arrival.current.set(rb.handle, { tArr: t.current, pPeakPa, tPlus, tMinus });
      }

      // If we’ve recorded an arrival, compute time-since-arrival and apply forces
      const rec = arrival.current.get(rb.handle);
      if (!rec) return;

      const tau = t.current - rec.tArr;

      let pNow = 0;
      if (tau <= rec.tPlus) {
        pNow = friedlander(rec.pPeakPa, tau, rec.tPlus); // positive phase
      } else if (tau <= rec.tPlus + rec.tMinus) {
        const s = (tau - rec.tPlus) / rec.tMinus;
        pNow = -afterflowScale * rec.pPeakPa * Math.max(0, 1 - s);
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
      const pushMagnitude = pNow * occ * forceScale;
      const minPushMagnitude = 0.25;
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
    const cutoff = maxDistance ?? derivedMaxDistance;
    if (R > cutoff && arrival.current.size === 0) {
      console.log("Shockwave done");
      done.current = true;
      // onDone?.();
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
