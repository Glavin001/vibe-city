/**
 * Rankine Vortex Physics for Tornado Simulation
 * 
 * Implements the Rankine Combined Vortex model which describes:
 * - Solid body rotation in the inner core (r < R_core)
 * - Irrotational (free) vortex flow in the outer region (r > R_core)
 * 
 * This model is the standard approximation used in meteorological studies
 * for tornado wind fields.
 */

import * as TSL from "three/tsl";
import { curlNoiseSimple } from "./noise";

// Type aliases for TSL nodes
type Vec3Node = ReturnType<typeof TSL.vec3>;
type FloatNode = ReturnType<typeof TSL.float>;

/**
 * Tornado parameters uniform interface
 */
export interface TornadoUniforms {
  tornadoPosition: ReturnType<typeof TSL.uniform>;    // vec3 - tornado center (x, z) and ground level (y)
  coreRadius: ReturnType<typeof TSL.uniform>;         // float - radius of the inner core
  maxTangentialVelocity: ReturnType<typeof TSL.uniform>; // float - maximum wind speed at core boundary
  height: ReturnType<typeof TSL.uniform>;             // float - total height of the tornado
  inflowStrength: ReturnType<typeof TSL.uniform>;     // float - radial inflow velocity scale
  updraftStrength: ReturnType<typeof TSL.uniform>;    // float - vertical velocity scale
  turbulenceStrength: ReturnType<typeof TSL.uniform>; // float - noise-based turbulence intensity
  rotationDirection: ReturnType<typeof TSL.uniform>;  // float - 1.0 or -1.0
  time: ReturnType<typeof TSL.uniform>;               // float - animation time
}

/**
 * Create tornado uniform structure with default values
 */
export function createTornadoUniforms(): TornadoUniforms {
  return {
    tornadoPosition: TSL.uniform(TSL.vec3(0, 0, 0)),
    coreRadius: TSL.uniform(50.0),
    maxTangentialVelocity: TSL.uniform(74.0), // EF3 default (~165 mph)
    height: TSL.uniform(500.0),
    inflowStrength: TSL.uniform(15.0),
    updraftStrength: TSL.uniform(40.0),
    turbulenceStrength: TSL.uniform(0.6),
    rotationDirection: TSL.uniform(1.0),
    time: TSL.uniform(0.0),
  };
}

/**
 * Calculate tangential (rotational) velocity using Rankine Vortex model
 * 
 * Inner core (r < R_core): V_θ = V_max × (r / R_core)  [solid body rotation]
 * Outer region (r > R_core): V_θ = V_max × (R_core / r) [irrotational vortex]
 * 
 * @param r - radial distance from tornado axis
 * @param rCore - core radius
 * @param vMax - maximum tangential velocity (at r = rCore)
 */
export const rankineVelocity = TSL.Fn(([r, rCore, vMax]: [FloatNode, FloatNode, FloatNode]) => {
  const ratio = r.div(rCore);
  
  // Solid body rotation in core, irrotational outside
  const solidBody = vMax.mul(ratio);
  const irrotational = vMax.div(ratio);
  
  // Smooth transition at boundary to avoid discontinuity
  const smoothness = TSL.float(0.1);
  const blend = TSL.smoothstep(
    TSL.float(1.0).sub(smoothness),
    TSL.float(1.0).add(smoothness),
    ratio
  );
  
  return TSL.mix(solidBody, irrotational, blend);
});

/**
 * Calculate radial inflow velocity
 * Air flows inward at ground level, creating the characteristic suction
 * 
 * V_r = -V_inflow × (1 - y/H) × exp(-r²/σ²)
 * 
 * @param r - radial distance
 * @param y - height above ground
 * @param height - total tornado height
 * @param inflowStrength - maximum inflow velocity
 * @param rCore - core radius (used for σ)
 */
export const radialInflowVelocity = TSL.Fn(([r, y, height, inflowStrength, rCore]: [FloatNode, FloatNode, FloatNode, FloatNode, FloatNode]) => {
  // Inflow is strongest at ground level, decreases with height
  const heightFactor = TSL.float(1.0).sub(TSL.clamp(y.div(height), 0.0, 1.0));
  
  // Gaussian falloff with distance
  const sigma = rCore.mul(2.0);
  const distanceFactor = TSL.exp(r.mul(r).div(sigma.mul(sigma)).mul(-1.0).mul(0.5));
  
  // Negative because flow is inward
  return inflowStrength.mul(heightFactor).mul(distanceFactor).mul(-1.0);
});

/**
 * Calculate vertical (updraft) velocity
 * Strong updraft in center, downdraft at edges
 * 
 * V_y = V_updraft × R_core² / (r² + R_core²) × (1 - exp(-y/H_transition))
 * 
 * @param r - radial distance
 * @param y - height above ground
 * @param rCore - core radius
 * @param updraftStrength - maximum updraft velocity
 */
export const verticalVelocity = TSL.Fn(([r, y, rCore, updraftStrength]: [FloatNode, FloatNode, FloatNode, FloatNode]) => {
  // Lorentzian profile - strongest in center, falls off with distance
  const rCore2 = rCore.mul(rCore);
  const r2 = r.mul(r);
  const radialFactor = rCore2.div(r2.add(rCore2));
  
  // Gradual onset of updraft with height (transition zone)
  const transitionHeight = TSL.float(50.0);
  const heightFactor = TSL.float(1.0).sub(TSL.exp(y.div(transitionHeight).mul(-1.0)));
  
  // Add slight downdraft at outer edges
  const outerDowndraft = TSL.smoothstep(rCore.mul(2.0), rCore.mul(4.0), r).mul(-0.3);
  
  return updraftStrength.mul(radialFactor).mul(heightFactor).add(outerDowndraft.mul(updraftStrength));
});

/**
 * Calculate the complete velocity field at a point
 * Combines tangential, radial, and vertical components
 * 
 * @param position - 3D world position
 * @param uniforms - tornado parameters
 */
export const calculateVortexVelocity = TSL.Fn(([position, tornadoPos, rCore, vMax, height, inflowStr, updraftStr, turbStr, rotDir, time]: [
  Vec3Node, Vec3Node, FloatNode, FloatNode, FloatNode, FloatNode, FloatNode, FloatNode, FloatNode, FloatNode
]) => {
  // Calculate position relative to tornado axis
  const relX = position.x.sub(tornadoPos.x);
  const relZ = position.z.sub(tornadoPos.z);
  const relY = position.y.sub(tornadoPos.y);
  
  // Radial distance from tornado axis (horizontal plane)
  const r = TSL.sqrt(relX.mul(relX).add(relZ.mul(relZ)));
  const rSafe = TSL.max(r, TSL.float(0.1)); // Avoid division by zero
  
  // Unit vector pointing away from axis (radial direction)
  const radialDirX = relX.div(rSafe);
  const radialDirZ = relZ.div(rSafe);
  
  // Unit vector perpendicular to radial (tangential direction)
  // For counter-clockwise rotation in XZ plane
  const tangentDirX = radialDirZ.mul(rotDir).mul(-1.0);
  const tangentDirZ = radialDirX.mul(rotDir);
  
  // Calculate velocity components
  const vTangential = rankineVelocity(rSafe, rCore, vMax);
  const vRadial = radialInflowVelocity(rSafe, relY, height, inflowStr, rCore);
  const vVertical = verticalVelocity(rSafe, relY, rCore, updraftStr);
  
  // Compose velocity vector
  const velX = tangentDirX.mul(vTangential).add(radialDirX.mul(vRadial));
  const velZ = tangentDirZ.mul(vTangential).add(radialDirZ.mul(vRadial));
  const velY = vVertical;
  
  // Add curl noise turbulence for realistic chaotic motion
  const noiseScale = TSL.float(0.02);
  const turbulence = curlNoiseSimple(position.mul(noiseScale), time);
  
  // Scale turbulence based on distance from core and height
  const turbulenceScale = turbStr.mul(vMax).mul(0.3);
  const distanceFactor = TSL.smoothstep(rCore.mul(3.0), rCore.mul(0.5), rSafe);
  const heightFactor = TSL.smoothstep(TSL.float(0.0), TSL.float(100.0), relY);
  
  const turbX = turbulence.x.mul(turbulenceScale).mul(distanceFactor).mul(heightFactor);
  const turbY = turbulence.y.mul(turbulenceScale).mul(distanceFactor).mul(heightFactor).mul(0.5);
  const turbZ = turbulence.z.mul(turbulenceScale).mul(distanceFactor).mul(heightFactor);
  
  return TSL.vec3(
    velX.add(turbX),
    velY.add(turbY),
    velZ.add(turbZ)
  );
});

/**
 * Calculate effective wind force on a particle/debris
 * Takes into account particle velocity to compute relative wind
 * 
 * F = 0.5 × ρ × Cd × A × |V_rel|² × V_rel_normalized
 * 
 * @param particleVel - current particle velocity
 * @param windVel - wind velocity at particle position
 * @param dragCoeff - drag coefficient (depends on particle shape)
 * @param area - effective cross-sectional area
 */
export const calculateDragForce = TSL.Fn(([particleVel, windVel, dragCoeff, area]: [Vec3Node, Vec3Node, FloatNode, FloatNode]) => {
  // Relative velocity (wind relative to particle)
  const relVel = windVel.sub(particleVel);
  const relSpeed = TSL.length(relVel);
  const relSpeedSafe = TSL.max(relSpeed, TSL.float(0.001));
  
  // Air density (approximately 1.225 kg/m³ at sea level)
  const airDensity = TSL.float(1.225);
  
  // Drag force magnitude: F = 0.5 × ρ × Cd × A × v²
  const forceMag = airDensity.mul(0.5).mul(dragCoeff).mul(area).mul(relSpeed).mul(relSpeed);
  
  // Force direction (same as relative velocity)
  const forceDir = relVel.div(relSpeedSafe);
  
  return forceDir.mul(forceMag);
});

/**
 * Calculate lift force for debris
 * Simulates how flat objects can be lifted by horizontal wind
 */
export const calculateLiftForce = TSL.Fn(([windVel, liftCoeff, area]: [Vec3Node, FloatNode, FloatNode]) => {
  // Horizontal wind speed
  const horizontalSpeed = TSL.sqrt(windVel.x.mul(windVel.x).add(windVel.z.mul(windVel.z)));
  
  // Air density
  const airDensity = TSL.float(1.225);
  
  // Lift force (upward): L = 0.5 × ρ × Cl × A × v²
  const liftMag = airDensity.mul(0.5).mul(liftCoeff).mul(area).mul(horizontalSpeed).mul(horizontalSpeed);
  
  return TSL.vec3(0.0, liftMag, 0.0);
});

/**
 * Calculate pressure at a point using simplified Bernoulli equation
 * Lower pressure in the vortex core creates suction effect
 * 
 * P(r) = P_ambient - ρ × V_θ² / 2
 */
export const calculatePressure = TSL.Fn(([r, rCore, vMax]: [FloatNode, FloatNode, FloatNode]) => {
  const ambientPressure = TSL.float(101325.0); // Pa (sea level)
  const airDensity = TSL.float(1.225);
  
  const vTangential = rankineVelocity(r, rCore, vMax);
  const dynamicPressure = airDensity.mul(0.5).mul(vTangential).mul(vTangential);
  
  return ambientPressure.sub(dynamicPressure);
});

/**
 * Calculate funnel shape radius at a given height
 * The funnel widens towards the top (wall cloud)
 */
export const funnelRadius = TSL.Fn(([y, height, rCore]: [FloatNode, FloatNode, FloatNode]) => {
  const normalizedHeight = TSL.clamp(y.div(height), 0.0, 1.0);
  
  // Funnel narrows at ground, widens exponentially towards top
  const widening = TSL.pow(normalizedHeight, TSL.float(0.7));
  const baseRadius = rCore.mul(0.3); // Narrowest at ground
  const topRadius = rCore.mul(3.0);  // Widest at top
  
  return TSL.mix(baseRadius, topRadius, widening);
});

/**
 * Calculate density field for volumetric rendering
 * Higher density in the visible funnel region
 */
export const funnelDensity = TSL.Fn(([position, tornadoPos, height, rCore, time]: [Vec3Node, Vec3Node, FloatNode, FloatNode, FloatNode]) => {
  const relX = position.x.sub(tornadoPos.x);
  const relZ = position.z.sub(tornadoPos.z);
  const relY = position.y.sub(tornadoPos.y);
  
  // Height check - no funnel above tornado height
  const heightMask = TSL.smoothstep(height, height.mul(0.95), relY);
  const groundMask = TSL.smoothstep(TSL.float(-10.0), TSL.float(10.0), relY);
  
  // Radial distance
  const r = TSL.sqrt(relX.mul(relX).add(relZ.mul(relZ)));
  
  // Get funnel radius at this height
  const fRadius = funnelRadius(relY, height, rCore);
  
  // Gaussian density profile
  const sigma = fRadius.mul(0.5);
  const baseDensity = TSL.exp(r.mul(r).div(sigma.mul(sigma)).mul(-1.0).mul(2.0));
  
  // Add noise for irregular edges
  const noiseScale = TSL.float(0.05);
  const noiseOffset = curlNoiseSimple(position.mul(noiseScale), time);
  const noiseDensity = baseDensity.mul(TSL.float(1.0).add(noiseOffset.x.mul(0.3)));
  
  return noiseDensity.mul(heightMask.oneMinus()).mul(groundMask);
});
