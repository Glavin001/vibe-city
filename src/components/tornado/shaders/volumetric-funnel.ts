/**
 * Volumetric Tornado Funnel Shader
 * 
 * Implements volumetric raymarching based on the Blender tutorial techniques:
 * - Cone shape via math: length(xy) * height_gradient
 * - Noise warping BEFORE length calculation (linear light blend)
 * - Height-dependent spiral rotation
 * - Density multiplication for visible volume
 * - Haze layer for surrounding dust cloud
 * 
 * This creates a smooth, cloud-like tornado appearance rather than grainy particles.
 */

import * as TSL from "three/tsl";
import { simplex3D } from "./noise";

// Type aliases for TSL nodes
type Vec3Node = ReturnType<typeof TSL.vec3>;
type FloatNode = ReturnType<typeof TSL.float>;

/**
 * Parameters for the volumetric tornado
 */
export interface VolumetricTornadoParams {
  uTime: ReturnType<typeof TSL.uniform<number>>;
  uCoreRadius: ReturnType<typeof TSL.uniform<number>>;
  uHeight: ReturnType<typeof TSL.uniform<number>>;
  uRotationDir: ReturnType<typeof TSL.uniform<number>>;
  uTurbulence: ReturnType<typeof TSL.uniform<number>>;
  uDensityMultiplier: ReturnType<typeof TSL.uniform<number>>;
  uNoiseScale: ReturnType<typeof TSL.uniform<number>>;
  uRotationSpeed: ReturnType<typeof TSL.uniform<number>>;
  uCameraPos: ReturnType<typeof TSL.uniform<ReturnType<typeof TSL.vec3>>>;
}

/**
 * Create uniforms for the volumetric tornado shader
 */
export function createVolumetricUniforms(): VolumetricTornadoParams {
  return {
    uTime: TSL.uniform(0.0),
    uCoreRadius: TSL.uniform(50.0),
    uHeight: TSL.uniform(500.0),
    uRotationDir: TSL.uniform(1.0),
    uTurbulence: TSL.uniform(0.6),
    uDensityMultiplier: TSL.uniform(40.0), // High multiplier like Blender tutorial
    uNoiseScale: TSL.uniform(0.02),
    uRotationSpeed: TSL.uniform(0.3),
    uCameraPos: TSL.uniform(TSL.vec3(0, 0, 0)),
  };
}

/**
 * Rotate a 2D point around the origin
 */
const rotate2D = TSL.Fn(([p, angle]: [ReturnType<typeof TSL.vec2>, FloatNode]) => {
  const c = TSL.cos(angle);
  const s = TSL.sin(angle);
  return TSL.vec2(
    c.mul(p.x).sub(s.mul(p.y)),
    s.mul(p.x).add(c.mul(p.y))
  );
});

/**
 * Compute tornado density at a sample point
 * Implements the Blender tutorial's cone shape math with noise warping
 */
const computeTornadoDensity = TSL.Fn(([
  samplePos,
  time,
  coreRadius,
  height,
  rotDir,
  turbulence,
  noiseScale,
  rotSpeed,
]: [Vec3Node, FloatNode, FloatNode, FloatNode, FloatNode, FloatNode, FloatNode, FloatNode]) => {
  
  // Local position (tornado centered at origin, extends upward in Y)
  const localPos = samplePos;
  
  // Height normalized 0-1 (bottom to top)
  const heightT = TSL.clamp(localPos.y.div(height), 0.0, 1.0);
  
  // === HEIGHT GRADIENT (from Blender tutorial) ===
  // Maps from 0 at bottom to 1 at top, but we need:
  // - Small radius at bottom (narrow funnel tip)
  // - Large radius at top (wide at cloud base)
  // Map to range [0.15, 1.8] like in plan
  const heightGradient = TSL.mix(TSL.float(0.15), TSL.float(1.8), heightT);
  
  // === HEIGHT-DEPENDENT ROTATION (from Blender tutorial) ===
  // Rotation increases with height - creates the classic spiral twist
  const rotAmount = heightT.mul(rotSpeed).mul(time).mul(rotDir);
  const xzRotated = rotate2D(TSL.vec2(localPos.x, localPos.z), rotAmount);
  const rotatedPos = TSL.vec3(xzRotated.x, localPos.y, xzRotated.y);
  
  // === NOISE POSITION WARPING (Linear Light Blend - KEY INSIGHT from Blender) ===
  // Mix noise INTO the position BEFORE calculating length
  // This warps the entire shape organically
  const noisePos = TSL.vec3(
    rotatedPos.x.mul(noiseScale),
    rotatedPos.y.mul(noiseScale.mul(0.5)), // Less vertical variation
    rotatedPos.z.mul(noiseScale)
  ).add(TSL.vec3(time.mul(0.02), time.mul(0.05), time.mul(0.02)));
  
  // Multi-octave noise for organic detail
  const noise1 = simplex3D(noisePos);
  const noise2 = simplex3D(noisePos.mul(2.0)).mul(0.5);
  const noise3 = simplex3D(noisePos.mul(4.0)).mul(0.25);
  const combinedNoise = noise1.add(noise2).add(noise3);
  
  // Warp strength increases with turbulence and height
  const warpStrength = turbulence.mul(coreRadius).mul(0.8).mul(heightT.add(0.3));
  const warpedPos = rotatedPos.add(TSL.vec3(
    combinedNoise.mul(warpStrength),
    TSL.float(0.0), // Don't warp Y
    combinedNoise.mul(warpStrength)
  ));
  
  // === CYLINDER TO CONE (from Blender tutorial) ===
  // Step 1: Cylinder = length(xz) only
  const cylinder = TSL.length(TSL.vec2(warpedPos.x, warpedPos.z));
  
  // Step 2: Divide by height gradient to get cone
  // Small gradient at bottom = large effective radius required
  // Large gradient at top = small effective radius required
  const cone = cylinder.div(heightGradient);
  
  // === DENSITY FALLOFF ===
  // Smoothstep from core radius to create soft edges
  const density = TSL.smoothstep(coreRadius, TSL.float(0.0), cone);
  
  // Add wispy edge detail using noise
  const edgeNoise = simplex3D(noisePos.mul(3.0)).mul(0.3).add(0.7);
  const wispyDensity = density.mul(edgeNoise);
  
  // Fade at very top and bottom
  const bottomFade = TSL.smoothstep(TSL.float(0.0), TSL.float(0.05), heightT);
  const topFade = TSL.smoothstep(TSL.float(1.0), TSL.float(0.9), heightT);
  
  return wispyDensity.mul(bottomFade).mul(topFade);
});

/**
 * Compute haze density (surrounding dust cloud)
 * Second layer with larger radius, lower density - from Blender tutorial
 */
const computeHazeDensity = TSL.Fn(([
  samplePos,
  time,
  coreRadius,
  height,
  rotDir,
  turbulence,
  noiseScale,
  rotSpeed,
]: [Vec3Node, FloatNode, FloatNode, FloatNode, FloatNode, FloatNode, FloatNode, FloatNode]) => {
  
  const localPos = samplePos;
  const heightT = TSL.clamp(localPos.y.div(height), 0.0, 1.0);
  
  // Haze uses LARGER radius (2.5x funnel) and concentrated at base
  const hazeHeightGradient = TSL.mix(TSL.float(0.3), TSL.float(2.5), heightT);
  
  // Slower rotation for outer haze
  const rotAmount = heightT.mul(rotSpeed.mul(0.4)).mul(time).mul(rotDir);
  const xzRotated = rotate2D(TSL.vec2(localPos.x, localPos.z), rotAmount);
  
  // Less warping for haze
  const noisePos = TSL.vec3(
    xzRotated.x.mul(noiseScale.mul(0.5)),
    localPos.y.mul(noiseScale.mul(0.3)),
    xzRotated.y.mul(noiseScale.mul(0.5))
  ).add(TSL.vec3(time.mul(0.01)));
  
  const noise = simplex3D(noisePos);
  const warpStrength = turbulence.mul(coreRadius).mul(1.5);
  const warpedXZ = TSL.vec2(xzRotated.x, xzRotated.y).add(
    TSL.vec2(noise.mul(warpStrength), noise.mul(warpStrength))
  );
  
  const cylinder = TSL.length(warpedXZ);
  const cone = cylinder.div(hazeHeightGradient);
  
  // Larger effective radius for haze
  const hazeRadius = coreRadius.mul(2.5);
  const density = TSL.smoothstep(hazeRadius, TSL.float(0.0), cone);
  
  // Haze concentrated at base, fading quickly with height
  const heightFalloff = TSL.pow(TSL.float(1.0).sub(heightT), TSL.float(1.5));
  
  // Add noise variation
  const hazeNoise = simplex3D(noisePos.mul(2.0)).mul(0.5).add(0.5);
  
  return density.mul(heightFalloff).mul(hazeNoise).mul(0.2); // Lower density than funnel
});

/**
 * Main raymarching fragment shader for volumetric tornado
 * Creates the smooth, cloud-like appearance
 */
export const createVolumetricTornadoShader = (uniforms: VolumetricTornadoParams) => {
  const {
    uTime,
    uCoreRadius,
    uHeight,
    uRotationDir,
    uTurbulence,
    uDensityMultiplier,
    uNoiseScale,
    uRotationSpeed,
    uCameraPos,
  } = uniforms;
  
  // Ray setup
  const worldPos = TSL.positionWorld;
  const viewDir = TSL.normalize(worldPos.sub(uCameraPos));
  
  // Volume bounds (local space of the box)
  const localPos = TSL.positionLocal;
  
  // Raymarch parameters
  const MAX_STEPS = 64;
  const stepSize = TSL.float(uHeight.div(MAX_STEPS));
  
  // Accumulated density and color
  const accumDensity = TSL.float(0.0).toVar("accumDensity");
  const accumColor = TSL.vec3(0.0, 0.0, 0.0).toVar("accumColor");
  
  // Starting position and direction
  // We start from the fragment's local position and march through the volume
  const rayOrigin = localPos.toVar("rayOrigin");
  const rayDir = TSL.normalize(viewDir).toVar("rayDir");
  
  // === RAYMARCH LOOP ===
  // TSL requires unrolled loops
  for (let i = 0; i < MAX_STEPS; i++) {
    // Current sample position
    const sampleOffset = rayDir.mul(stepSize.mul(i));
    const samplePos = rayOrigin.add(sampleOffset);
    
    // Skip if outside volume bounds
    const inBoundsY = samplePos.y.greaterThan(0.0).and(samplePos.y.lessThan(uHeight));
    const distFromCenter = TSL.length(TSL.vec2(samplePos.x, samplePos.z));
    const inBoundsXZ = distFromCenter.lessThan(uCoreRadius.mul(4.0));
    
    TSL.If(inBoundsY.and(inBoundsXZ), () => {
      // === MAIN FUNNEL DENSITY ===
      const funnelDensity = computeTornadoDensity(
        samplePos,
        uTime,
        uCoreRadius,
        uHeight,
        uRotationDir,
        uTurbulence,
        uNoiseScale,
        uRotationSpeed
      );
      
      // === HAZE LAYER DENSITY ===
      const hazeDensity = computeHazeDensity(
        samplePos,
        uTime,
        uCoreRadius,
        uHeight,
        uRotationDir,
        uTurbulence,
        uNoiseScale,
        uRotationSpeed
      );
      
      // Combined density with multiplier (40x from Blender tutorial)
      const totalDensity = funnelDensity.add(hazeDensity).mul(uDensityMultiplier).mul(stepSize.div(uHeight));
      
      // === COLOR FROM DENSITY (Color Ramp from Blender) ===
      const heightT = TSL.clamp(samplePos.y.div(uHeight), 0.0, 1.0);
      
      // Noise for color variation
      const colorNoisePos = samplePos.mul(0.01).add(TSL.vec3(uTime.mul(0.02)));
      const colorNoise = simplex3D(colorNoisePos).mul(0.5).add(0.5);
      
      // Dark charcoal tornado colors (almost black core, slightly lighter edges)
      const darkCore = TSL.vec3(0.06, 0.06, 0.06);    // Almost black
      const midTone = TSL.vec3(0.12, 0.11, 0.10);     // Dark charcoal
      const lightEdge = TSL.vec3(0.22, 0.20, 0.18);   // Lighter gray at edges
      
      // Color varies with density and height
      const densityBlend = TSL.clamp(funnelDensity.mul(2.0), 0.0, 1.0);
      const baseColor = TSL.mix(lightEdge, darkCore, densityBlend);
      
      // Add slight height variation (lighter toward cloud base)
      const heightColor = TSL.mix(baseColor, midTone, heightT.mul(0.3));
      
      // Add noise variation
      const finalSampleColor = heightColor.add(colorNoise.sub(0.5).mul(0.05));
      
      // === BEER-LAMBERT ACCUMULATION ===
      // Realistic light absorption through volume
      const transmittance = TSL.exp(accumDensity.mul(-1.0));
      
      accumColor.addAssign(finalSampleColor.mul(totalDensity).mul(transmittance));
      accumDensity.addAssign(totalDensity);
    });
    
    // Early exit if fully opaque
    TSL.If(accumDensity.greaterThan(4.0), () => {
      // Break equivalent - can't actually break in TSL, but this prevents further accumulation
      accumDensity.assign(4.0);
    });
  }
  
  // Final alpha from accumulated density
  const alpha = TSL.float(1.0).sub(TSL.exp(accumDensity.mul(-1.0)));
  
  return {
    colorNode: accumColor,
    opacityNode: alpha,
  };
};

/**
 * Simplified volumetric shader using screen-space approach
 * More compatible with TSL limitations
 */
export const createSimpleVolumetricShader = (uniforms: VolumetricTornadoParams) => {
  const {
    uTime,
    uCoreRadius,
    uHeight,
    uRotationDir,
    uTurbulence,
    uDensityMultiplier,
    uNoiseScale,
    uRotationSpeed,
  } = uniforms;
  
  // Use world position directly
  const worldPos = TSL.positionWorld;
  
  // Compute single-sample density at this fragment
  const funnelDensity = computeTornadoDensity(
    worldPos,
    uTime,
    uCoreRadius,
    uHeight,
    uRotationDir,
    uTurbulence,
    uNoiseScale,
    uRotationSpeed
  );
  
  const hazeDensity = computeHazeDensity(
    worldPos,
    uTime,
    uCoreRadius,
    uHeight,
    uRotationDir,
    uTurbulence,
    uNoiseScale,
    uRotationSpeed
  );
  
  // Combined density
  const totalDensity = funnelDensity.add(hazeDensity);
  
  // Height for color variation
  const heightT = TSL.clamp(worldPos.y.div(uHeight), 0.0, 1.0);
  
  // Color noise
  const colorNoisePos = worldPos.mul(0.015).add(TSL.vec3(uTime.mul(0.03)));
  const colorNoise = simplex3D(colorNoisePos).mul(0.5).add(0.5);
  
  // Tornado colors - dark charcoal
  const darkCore = TSL.vec3(0.05, 0.05, 0.05);
  const midTone = TSL.vec3(0.10, 0.09, 0.08);
  const lightEdge = TSL.vec3(0.18, 0.16, 0.14);
  
  // Mix based on density
  const densityBlend = TSL.pow(totalDensity, TSL.float(0.5));
  const baseColor = TSL.mix(lightEdge, darkCore, densityBlend);
  const heightColor = TSL.mix(baseColor, midTone, heightT.mul(0.2));
  const finalColor = heightColor.mul(colorNoise.mul(0.3).add(0.85));
  
  // Opacity from density with multiplier
  const alpha = TSL.clamp(totalDensity.mul(uDensityMultiplier), 0.0, 1.0);
  
  return {
    colorNode: finalColor,
    opacityNode: alpha,
  };
};



