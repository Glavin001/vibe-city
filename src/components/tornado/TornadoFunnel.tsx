/**
 * Volumetric Tornado Funnel Component
 * 
 * Uses multiple layered cylindrical shells to create volumetric appearance.
 * Based on Blender tutorial techniques:
 * - Cone shape from length(xy) / height_gradient
 * - Noise warping BEFORE length calculation (linear light blend)
 * - Height-dependent spiral rotation
 * - Multiple transparent layers for volumetric depth
 */

"use client";

import { useRef, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three/webgpu";
import * as TSL from "three/tsl";
import type { TornadoParams } from "@/app/tornado/page";
import { simplex3D } from "./shaders/noise";

interface TornadoFunnelProps {
  params: TornadoParams;
  tornadoPosition: THREE.Vector3;
}

// Number of concentric shell layers for volumetric effect
const NUM_LAYERS = 20;

/**
 * Main Volumetric Tornado Funnel
 * Renders multiple concentric shell layers for volumetric appearance
 */
export default function TornadoFunnel({ params, tornadoPosition }: TornadoFunnelProps) {
  useThree(); // For WebGPU context
  const groupRef = useRef<THREE.Group>(null);
  const clockRef = useRef(new THREE.Clock());
  
  // Shared uniforms for all layers
  const uniforms = useMemo(() => ({
    uTime: TSL.uniform(0.0),
    uCoreRadius: TSL.uniform(params.coreRadius),
    uHeight: TSL.uniform(params.height),
    uRotationDir: TSL.uniform(params.rotationDirection),
    uTurbulence: TSL.uniform(params.turbulence),
  }), [params.coreRadius, params.height, params.rotationDirection, params.turbulence]);
  
  // Update uniforms each frame
  useFrame(() => {
    const time = clockRef.current.getElapsedTime();
    uniforms.uTime.value = time;
    uniforms.uCoreRadius.value = params.coreRadius;
    uniforms.uHeight.value = params.height;
    uniforms.uRotationDir.value = params.rotationDirection;
    uniforms.uTurbulence.value = params.turbulence;
    
    // Update group position
    if (groupRef.current) {
      groupRef.current.position.set(tornadoPosition.x, tornadoPosition.y, tornadoPosition.z);
    }
  });
  
  // Create layer indices array
  const layers = useMemo(() => 
    Array.from({ length: NUM_LAYERS }, (_, i) => ({
      index: i,
      t: i / (NUM_LAYERS - 1), // 0 to 1
    })),
    []
  );
  
  return (
    <group ref={groupRef} name="volumetric-tornado-funnel">
      {/* Render shells from outside to inside for proper blending */}
      {layers.map(({ index, t }) => (
        <TornadoShellLayer
          key={`shell-${index}`}
          params={params}
          layerT={1 - t} // Render outer to inner
          uniforms={uniforms}
        />
      ))}
      
      {/* Inner core - solid dark center */}
      <InnerCore params={params} uniforms={uniforms} />
    </group>
  );
}

/**
 * Single tornado shell layer
 */
function TornadoShellLayer({
  params,
  layerT,
  uniforms,
}: {
  params: TornadoParams;
  layerT: number;
  uniforms: {
    uTime: ReturnType<typeof TSL.uniform<number>>;
    uCoreRadius: ReturnType<typeof TSL.uniform<number>>;
    uHeight: ReturnType<typeof TSL.uniform<number>>;
    uRotationDir: ReturnType<typeof TSL.uniform<number>>;
    uTurbulence: ReturnType<typeof TSL.uniform<number>>;
  };
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  
  // Create cone geometry for this layer
  const geometry = useMemo(() => {
    const radiusScale = 0.4 + layerT * 1.8; // Range from 0.4 to 2.2
    
    // Cone: narrow at bottom, wide at top - realistic tornado proportions
    const bottomRadius = params.coreRadius * 0.15 * radiusScale;
    const topRadius = params.coreRadius * 1.4 * radiusScale;
    
    // Create cylinder with different top/bottom radii (cone)
    const geo = new THREE.CylinderGeometry(
      topRadius,      // top radius
      bottomRadius,   // bottom radius
      params.height,  // height
      48,             // radial segments
      24,             // height segments
      true            // open-ended
    );
    
    // Move so bottom is at y=0
    geo.translate(0, params.height / 2, 0);
    
    return geo;
  }, [params.coreRadius, params.height, layerT]);
  
  // Material with volumetric-style shader
  const material = useMemo(() => {
    const mat = new THREE.MeshBasicNodeMaterial();
    
    const {
      uTime,
      uCoreRadius,
      uHeight,
      uRotationDir,
      uTurbulence,
    } = uniforms;
    
    // Layer-specific radius scale
    const layerRadiusScale = TSL.float(0.4 + layerT * 1.8);
    
    const worldPos = TSL.positionWorld;
    const heightT = TSL.clamp(worldPos.y.div(uHeight), 0.0, 1.0);
    
    // === HEIGHT GRADIENT (from Blender tutorial) ===
    const heightGradient = TSL.mix(TSL.float(0.15), TSL.float(1.4), TSL.pow(heightT, TSL.float(0.55)));
    
    // === HEIGHT-DEPENDENT ROTATION ===
    const rotationSpeed = TSL.float(0.35);
    const rotAmount = heightT.mul(rotationSpeed).mul(uTime).mul(uRotationDir);
    const cosRot = TSL.cos(rotAmount);
    const sinRot = TSL.sin(rotAmount);
    const rotatedX = cosRot.mul(worldPos.x).sub(sinRot.mul(worldPos.z));
    const rotatedZ = sinRot.mul(worldPos.x).add(cosRot.mul(worldPos.z));
    
    // === NOISE POSITION WARPING ===
    const noiseScale = TSL.float(0.012);
    const noisePos = TSL.vec3(
      rotatedX.mul(noiseScale),
      worldPos.y.mul(noiseScale.mul(0.3)),
      rotatedZ.mul(noiseScale)
    ).add(TSL.vec3(uTime.mul(0.012), uTime.mul(0.025), uTime.mul(0.012)));
    
    // Multi-octave noise
    const noise1 = simplex3D(noisePos);
    const noise2 = simplex3D(noisePos.mul(2.2)).mul(0.45);
    const combinedNoise = noise1.add(noise2);
    
    // Warp strength
    const warpStrength = uTurbulence.mul(uCoreRadius).mul(0.5).mul(heightT.mul(0.5).add(0.5));
    const warpedX = rotatedX.add(combinedNoise.mul(warpStrength));
    const warpedZ = rotatedZ.add(combinedNoise.mul(warpStrength));
    
    // === CYLINDER TO CONE ===
    const cylinder = TSL.length(TSL.vec2(warpedX, warpedZ));
    const cone = cylinder.div(heightGradient);
    
    // === LAYER-SPECIFIC DENSITY ===
    const layerRadius = uCoreRadius.mul(layerRadiusScale);
    const innerRadius = layerRadius.mul(0.8);
    const outerRadius = layerRadius.mul(1.2);
    
    // Density peaks at this layer's radius
    const distFromLayerRadius = TSL.abs(cone.sub(layerRadius));
    const layerThickness = outerRadius.sub(innerRadius);
    const layerDensity = TSL.smoothstep(layerThickness, TSL.float(0.0), distFromLayerRadius);
    
    // Core contribution
    const coreDensity = TSL.smoothstep(uCoreRadius.mul(0.4), TSL.float(0.0), cone).mul(0.4);
    
    // Wispy edges
    const edgeNoise = simplex3D(noisePos.mul(3.0)).mul(0.35).add(0.65);
    const baseDensity = layerDensity.add(coreDensity).mul(edgeNoise);
    
    // Fade at top and bottom
    const bottomFade = TSL.smoothstep(TSL.float(0.0), TSL.float(0.08), heightT);
    const topFade = TSL.smoothstep(TSL.float(1.0), TSL.float(0.88), heightT);
    const fadedDensity = baseDensity.mul(bottomFade).mul(topFade);
    
    // === COLOR ===
    const darkCore = TSL.vec3(0.03, 0.03, 0.03);
    const lightEdge = TSL.vec3(0.13, 0.11, 0.10);
    
    // Color based on distance from core
    const radiusBlend = TSL.clamp(cone.div(uCoreRadius), 0.0, 1.0);
    const baseColor = TSL.mix(darkCore, lightEdge, radiusBlend);
    
    // Add noise variation
    const colorNoise = simplex3D(worldPos.mul(0.008).add(TSL.vec3(uTime.mul(0.015))));
    const colorVar = colorNoise.mul(0.05);
    const finalColor = baseColor.add(TSL.vec3(colorVar, colorVar, colorVar));
    
    mat.colorNode = finalColor;
    
    // === OPACITY ===
    // Inner layers more opaque
    const innerOpacity = (1 - layerT) * 0.35;
    const outerOpacity = layerT * 0.15;
    const baseOpacity = 0.2 + innerOpacity + outerOpacity;
    const alpha = TSL.clamp(fadedDensity.mul(TSL.float(baseOpacity)), 0.0, 0.6);
    
    mat.opacityNode = alpha;
    
    mat.transparent = true;
    mat.depthWrite = false;
    mat.side = THREE.DoubleSide;
    mat.blending = THREE.NormalBlending;
    
    return mat;
  }, [uniforms, layerT]);
  
  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      frustumCulled={false}
    />
  );
}

/**
 * Inner solid core of the tornado
 */
function InnerCore({
  params,
  uniforms,
}: {
  params: TornadoParams;
  uniforms: {
    uTime: ReturnType<typeof TSL.uniform<number>>;
    uHeight: ReturnType<typeof TSL.uniform<number>>;
    uRotationDir: ReturnType<typeof TSL.uniform<number>>;
  };
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  
  // Narrow cone for the core
  const geometry = useMemo(() => {
    const bottomRadius = params.coreRadius * 0.05;
    const topRadius = params.coreRadius * 0.35;
    
    const geo = new THREE.CylinderGeometry(
      topRadius,
      bottomRadius,
      params.height * 0.95,
      32,
      20,
      true
    );
    geo.translate(0, params.height * 0.95 / 2, 0);
    return geo;
  }, [params.coreRadius, params.height]);
  
  const material = useMemo(() => {
    const mat = new THREE.MeshBasicNodeMaterial();
    
    const { uTime, uHeight, uRotationDir } = uniforms;
    
    const worldPos = TSL.positionWorld;
    const heightT = TSL.clamp(worldPos.y.div(uHeight), 0.0, 1.0);
    
    // Rotation
    const rotAmount = heightT.mul(TSL.float(0.4)).mul(uTime).mul(uRotationDir);
    const cosRot = TSL.cos(rotAmount);
    const sinRot = TSL.sin(rotAmount);
    const rotatedX = cosRot.mul(worldPos.x).sub(sinRot.mul(worldPos.z));
    const rotatedZ = sinRot.mul(worldPos.x).add(cosRot.mul(worldPos.z));
    
    // Noise
    const noisePos = TSL.vec3(rotatedX, worldPos.y, rotatedZ).mul(0.02).add(TSL.vec3(uTime.mul(0.02)));
    const noise = simplex3D(noisePos);
    
    // Very dark core
    const coreColor = TSL.vec3(0.02, 0.02, 0.02);
    const variedColor = coreColor.add(noise.mul(0.015));
    
    mat.colorNode = variedColor;
    
    // Opacity
    const bottomFade = TSL.smoothstep(TSL.float(0.0), TSL.float(0.05), heightT);
    const topFade = TSL.smoothstep(TSL.float(1.0), TSL.float(0.85), heightT);
    mat.opacityNode = bottomFade.mul(topFade).mul(0.9);
    
    mat.transparent = true;
    mat.depthWrite = false;
    mat.side = THREE.DoubleSide;
    
    return mat;
  }, [uniforms]);
  
  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      frustumCulled={false}
    />
  );
}
