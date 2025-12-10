/**
 * Atmospheric Effects for Tornado Simulation
 * 
 * Includes:
 * - Wall cloud (mesocyclone base)
 * - Ground dust ring
 * - Sky dome with storm colors
 * - Volumetric fog/haze
 * - Lightning flashes (optional)
 */

"use client";

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three/webgpu";
import * as TSL from "three/tsl";
import type { TornadoParams } from "@/app/tornado/page";
import { simplex3D } from "./shaders/noise";

interface AtmosphereEffectsProps {
  params: TornadoParams;
  tornadoPosition: THREE.Vector3;
}

/**
 * Wall cloud - the dark, rotating mesocyclone from which the tornado descends
 * Based on reference images: dark, ominous, with visible green tint
 */
function WallCloud({ params, tornadoPosition }: AtmosphereEffectsProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const lowerCloudRef = useRef<THREE.Mesh>(null);
  
  // Create larger disk geometry for the wall cloud
  const geometry = useMemo(() => {
    const radius = params.coreRadius * 6; // Much larger
    const segments = 96;
    const geo = new THREE.CircleGeometry(radius, segments);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [params.coreRadius]);
  
  // Main wall cloud material - dark and ominous
  const material = useMemo(() => {
    const mat = new THREE.MeshBasicNodeMaterial();
    
    const uTime = TSL.uniform(0.0);
    const uRotDir = TSL.uniform(params.rotationDirection);
    const uRadius = TSL.uniform(params.coreRadius * 6);
    const uCoreRadius = TSL.uniform(params.coreRadius);
    
    const localPos = TSL.positionLocal;
    const dist = TSL.length(localPos.xz);
    const angle = TSL.atan(localPos.z, localPos.x);
    const normalizedDist = dist.div(uRadius);
    
    // Animated rotation - faster near center
    const rotSpeed = TSL.mix(TSL.float(0.6), TSL.float(0.15), normalizedDist);
    const rotAngle = angle.add(uTime.mul(rotSpeed).mul(uRotDir));
    
    // Multiple spiral arms for realistic mesocyclone look
    const spiralArms = TSL.float(5.0);
    const spiralTightness = TSL.float(0.08);
    const spiralPhase = rotAngle.mul(spiralArms).add(dist.mul(spiralTightness));
    const spiral = TSL.pow(TSL.sin(spiralPhase).mul(0.5).add(0.5), TSL.float(0.7));
    
    // Multi-octave noise for cloud detail
    const noisePos1 = TSL.vec3(
      TSL.cos(rotAngle).mul(dist).mul(0.015),
      uTime.mul(0.05),
      TSL.sin(rotAngle).mul(dist).mul(0.015)
    );
    const noise1 = simplex3D(noisePos1);
    
    const noisePos2 = TSL.vec3(
      TSL.cos(rotAngle).mul(dist).mul(0.04),
      uTime.mul(0.08),
      TSL.sin(rotAngle).mul(dist).mul(0.04)
    );
    const noise2 = simplex3D(noisePos2).mul(0.5);
    
    const combinedNoise = noise1.add(noise2);
    
    // DARK storm cloud colors with green tint (from reference)
    const veryDark = TSL.vec3(0.08, 0.09, 0.08);     // Almost black
    const darkGreen = TSL.vec3(0.12, 0.15, 0.12);    // Dark gray-green
    const midGreen = TSL.vec3(0.18, 0.22, 0.18);     // Gray-green
    const highlight = TSL.vec3(0.25, 0.28, 0.25);    // Lighter edge
    
    // Core is darkest, gets slightly lighter toward edges
    const coreBlend = TSL.smoothstep(uCoreRadius.mul(2.0), uCoreRadius.mul(0.5), dist);
    const darkCore = TSL.mix(darkGreen, veryDark, coreBlend);
    
    // Mix with spiral pattern
    const spiralColor = TSL.mix(darkCore, midGreen, spiral.mul(0.4));
    
    // Add noise variation
    const noisyColor = spiralColor.add(combinedNoise.mul(0.04));
    
    // Edge highlight from backlighting
    const edgeGlow = TSL.smoothstep(uRadius.mul(0.7), uRadius, dist);
    const finalColor = TSL.mix(noisyColor, highlight, edgeGlow.mul(0.3));
    
    mat.colorNode = finalColor;
    
    // Opacity - very dense, with hole in center for funnel
    const funnelHole = TSL.smoothstep(uCoreRadius.mul(0.8), uCoreRadius.mul(2.0), dist);
    const outerFade = TSL.smoothstep(uRadius, uRadius.mul(0.6), dist);
    const spiralOpacity = spiral.mul(0.2).add(0.7);
    const opacity = funnelHole.mul(outerFade).mul(spiralOpacity).mul(0.92);
    
    mat.opacityNode = opacity;
    mat.transparent = true;
    mat.depthWrite = false;
    mat.side = THREE.DoubleSide;
    
    (mat as unknown as { userData: { uTime: typeof uTime; uRotDir: typeof uRotDir } }).userData = { uTime, uRotDir };
    
    return mat;
  }, [params.rotationDirection, params.coreRadius]);
  
  // Lower rotating cloud layer for depth
  const lowerMaterial = useMemo(() => {
    const mat = new THREE.MeshBasicNodeMaterial();
    
    const uTime = TSL.uniform(0.0);
    const uRotDir = TSL.uniform(params.rotationDirection);
    const uRadius = TSL.uniform(params.coreRadius * 5);
    
    const localPos = TSL.positionLocal;
    const dist = TSL.length(localPos.xz);
    const angle = TSL.atan(localPos.z, localPos.x);
    
    // Faster rotation
    const rotAngle = angle.add(uTime.mul(0.4).mul(uRotDir));
    
    // Wispy tendrils
    const tendrilPhase = rotAngle.mul(8.0).add(dist.mul(0.12));
    const tendrils = TSL.pow(TSL.abs(TSL.sin(tendrilPhase)), TSL.float(0.5));
    
    // Very dark color
    const tendrilColor = TSL.vec3(0.06, 0.07, 0.06);
    
    mat.colorNode = tendrilColor;
    
    const innerFade = TSL.smoothstep(params.coreRadius * 0.5, params.coreRadius * 1.5, dist);
    const outerFade = TSL.smoothstep(uRadius, uRadius.mul(0.4), dist);
    mat.opacityNode = tendrils.mul(innerFade).mul(outerFade).mul(0.6);
    
    mat.transparent = true;
    mat.depthWrite = false;
    mat.side = THREE.DoubleSide;
    
    (mat as unknown as { userData: { uTime: typeof uTime; uRotDir: typeof uRotDir } }).userData = { uTime, uRotDir };
    
    return mat;
  }, [params.rotationDirection, params.coreRadius]);
  
  const lowerGeometry = useMemo(() => {
    const geo = new THREE.CircleGeometry(params.coreRadius * 5, 64);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [params.coreRadius]);
  
  useFrame(({ clock }) => {
    const time = clock.getElapsedTime();
    
    if (meshRef.current) {
      meshRef.current.position.set(tornadoPosition.x, params.height, tornadoPosition.z);
    }
    if (lowerCloudRef.current) {
      lowerCloudRef.current.position.set(tornadoPosition.x, params.height - 30, tornadoPosition.z);
    }
    
    const updateMaterial = (mat: THREE.MeshBasicNodeMaterial) => {
      const userData = (mat as unknown as { userData?: { uTime?: { value: number }; uRotDir?: { value: number } } }).userData;
      if (userData) {
        if (userData.uTime) userData.uTime.value = time;
        if (userData.uRotDir) userData.uRotDir.value = params.rotationDirection;
      }
    };
    
    updateMaterial(material);
    updateMaterial(lowerMaterial);
  });
  
  return (
    <>
      <mesh ref={meshRef} geometry={geometry} material={material} />
      <mesh ref={lowerCloudRef} geometry={lowerGeometry} material={lowerMaterial} />
    </>
  );
}

/**
 * Ground dust effect - radial dust streaks being pulled into the tornado
 * Replaces concentric rings with realistic swirling dust pattern
 */
function GroundDustRing({ params, tornadoPosition }: AtmosphereEffectsProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  
  // Create larger disk geometry for ground dust
  const geometry = useMemo(() => {
    const radius = params.coreRadius * 4; // Much wider area
    const segments = 128;
    const geo = new THREE.CircleGeometry(radius, segments);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [params.coreRadius]);
  
  // Animated radial dust streaks material
  const material = useMemo(() => {
    const mat = new THREE.MeshBasicNodeMaterial();
    
    const uTime = TSL.uniform(0.0);
    const uRotDir = TSL.uniform(params.rotationDirection);
    const uCoreRadius = TSL.uniform(params.coreRadius);
    const uOuterRadius = TSL.uniform(params.coreRadius * 4);
    
    const localPos = TSL.positionLocal;
    const dist = TSL.length(localPos.xz);
    const angle = TSL.atan(localPos.z, localPos.x);
    
    // Radial streaks - dust being pulled inward
    // Faster rotation near center (Rankine vortex behavior)
    const normalizedDist = dist.div(uOuterRadius);
    const angularSpeed = TSL.mix(TSL.float(2.5), TSL.float(0.3), normalizedDist);
    const rotAngle = angle.add(uTime.mul(angularSpeed).mul(uRotDir));
    
    // Create radial streak pattern (not circles)
    const streakCount = TSL.float(24.0);
    const streakPhase = rotAngle.mul(streakCount);
    const streak = TSL.pow(TSL.abs(TSL.sin(streakPhase)), TSL.float(0.3));
    
    // Add inward-flowing noise for dust kicked up
    const noiseScale = TSL.float(0.03);
    const flowOffset = uTime.mul(0.5).mul(uRotDir);
    const noisePos = TSL.vec3(
      TSL.cos(rotAngle.add(flowOffset)).mul(dist).mul(noiseScale),
      dist.mul(0.01),
      TSL.sin(rotAngle.add(flowOffset)).mul(dist).mul(noiseScale)
    );
    const noise = simplex3D(noisePos).mul(0.5).add(0.5);
    
    // Brown/tan dust colors matching reference images
    const innerDust = TSL.vec3(0.55, 0.45, 0.35);  // #8B7359 tan
    const outerDust = TSL.vec3(0.4, 0.35, 0.28);   // Darker brown at edges
    const dustColor = TSL.mix(innerDust, outerDust, normalizedDist);
    
    // Add variation
    const variedColor = dustColor.mul(TSL.float(0.8).add(noise.mul(0.4)));
    
    mat.colorNode = variedColor;
    
    // Opacity - concentrated around tornado base, fading outward
    // Inner dark zone (tornado shadow)
    const innerZone = TSL.smoothstep(uCoreRadius.mul(0.3), uCoreRadius.mul(1.5), dist);
    // Dense dust ring
    const dustRing = TSL.smoothstep(uCoreRadius.mul(0.5), uCoreRadius.mul(2.0), dist)
      .mul(TSL.smoothstep(uOuterRadius, uCoreRadius.mul(2.5), dist));
    // Streak visibility
    const streakOpacity = streak.mul(noise).mul(dustRing).mul(innerZone);
    
    // Overall opacity with radial falloff
    const radialFade = TSL.smoothstep(uOuterRadius, uCoreRadius, dist);
    mat.opacityNode = streakOpacity.mul(0.7).add(radialFade.mul(0.15));
    
    mat.transparent = true;
    mat.depthWrite = false;
    mat.side = THREE.DoubleSide;
    
    (mat as unknown as { userData: { uTime: typeof uTime; uRotDir: typeof uRotDir } }).userData = { uTime, uRotDir };
    
    return mat;
  }, [params.coreRadius, params.rotationDirection]);
  
  useFrame(({ clock }) => {
    const time = clock.getElapsedTime();
    
    if (meshRef.current) {
      meshRef.current.position.set(tornadoPosition.x, 0.2, tornadoPosition.z);
    }
    
    const userData = (material as unknown as { userData?: { uTime?: { value: number }; uRotDir?: { value: number } } }).userData;
    if (userData) {
      if (userData.uTime) userData.uTime.value = time;
      if (userData.uRotDir) userData.uRotDir.value = params.rotationDirection;
    }
  });
  
  return <mesh ref={meshRef} geometry={geometry} material={material} />;
}

/**
 * Sky dome with dramatic storm atmosphere
 * Creates the characteristic backlit appearance seen in tornado photos
 */
function StormSky({ params }: { params: TornadoParams }) {
  const meshRef = useRef<THREE.Mesh>(null);
  
  const geometry = useMemo(() => {
    return new THREE.SphereGeometry(5000, 64, 64);
  }, []);
  
  const material = useMemo(() => {
    const mat = new THREE.MeshBasicNodeMaterial();
    
    const uTime = TSL.uniform(0.0);
    const uTimeOfDay = TSL.uniform(params.timeOfDay);
    
    const worldPos = TSL.positionWorld;
    const normalizedY = worldPos.y.div(5000.0).add(0.5);
    
    // Horizontal angle for directional lighting effect
    const horizontalAngle = TSL.atan(worldPos.z, worldPos.x);
    
    // Time of day affects base brightness
    const dayPhase = uTimeOfDay.div(24.0).mul(Math.PI * 2);
    const daylight = TSL.cos(dayPhase).mul(-0.5).add(0.5);
    
    // DRAMATIC storm sky colors - darker overall with backlit effect
    // Zenith (top of sky) - very dark storm clouds
    const zenithDark = TSL.vec3(0.08, 0.10, 0.09);      // Dark gray-green
    const zenithMid = TSL.vec3(0.15, 0.18, 0.16);       // Medium dark
    
    // Horizon - brighter (backlit effect) with yellow/orange tinge
    const horizonBright = TSL.vec3(0.55, 0.50, 0.40);   // Bright yellowish (backlit)
    const horizonGreen = TSL.vec3(0.35, 0.40, 0.32);    // Green storm tint
    
    // Storm cell overhead - very dark
    const stormOverhead = TSL.vec3(0.05, 0.06, 0.05);
    
    // Create dramatic contrast - dark overhead, bright horizon
    const horizonGlow = TSL.pow(TSL.float(1.0).sub(normalizedY), TSL.float(4.0));
    const zenithDarkness = TSL.pow(normalizedY, TSL.float(1.5));
    
    // Directional backlight - brighter in one direction (sun behind storm)
    const backlightDir = TSL.sin(horizontalAngle.add(Math.PI * 0.25)).mul(0.5).add(0.5);
    const backlightIntensity = horizonGlow.mul(backlightDir).mul(daylight);
    
    // Base sky color - dark overhead
    const baseZenith = TSL.mix(zenithDark, zenithMid, daylight.mul(0.5));
    
    // Horizon color with backlight
    const backlitHorizon = TSL.mix(horizonGreen, horizonBright, backlightIntensity);
    
    // Blend based on height
    const skyColor = TSL.mix(backlitHorizon, baseZenith, zenithDarkness);
    
    // Add green storm tint at mid-levels
    const midLevel = TSL.smoothstep(TSL.float(0.2), TSL.float(0.5), normalizedY)
      .mul(TSL.smoothstep(TSL.float(0.8), TSL.float(0.5), normalizedY));
    const greenTint = TSL.vec3(0.0, 0.03, 0.0);
    const withGreen = skyColor.add(greenTint.mul(midLevel).mul(daylight));
    
    // Animated cloud layers with movement
    const cloudSpeed1 = uTime.mul(0.005);
    const cloudSpeed2 = uTime.mul(0.008);
    
    // Large-scale cloud structure
    const noisePos1 = worldPos.mul(0.0003).add(TSL.vec3(cloudSpeed1, 0.0, 0.0));
    const cloudNoise1 = simplex3D(noisePos1).mul(0.5).add(0.5);
    
    // Smaller detail
    const noisePos2 = worldPos.mul(0.001).add(TSL.vec3(cloudSpeed2, 0.0, cloudSpeed2));
    const cloudNoise2 = simplex3D(noisePos2).mul(0.5).add(0.5);
    
    const combinedClouds = cloudNoise1.mul(0.7).add(cloudNoise2.mul(0.3));
    
    // Cloud colors - darker storm clouds
    const darkCloud = TSL.vec3(0.12, 0.14, 0.13);
    const lightCloud = TSL.vec3(0.25, 0.27, 0.26);
    const cloudColor = TSL.mix(darkCloud, lightCloud, combinedClouds);
    
    // Apply clouds with height-based density
    const cloudDensity = TSL.smoothstep(TSL.float(0.35), TSL.float(0.55), combinedClouds);
    const cloudHeight = TSL.smoothstep(TSL.float(0.3), TSL.float(0.7), normalizedY);
    const finalColor = TSL.mix(withGreen, cloudColor, cloudDensity.mul(cloudHeight).mul(0.6));
    
    mat.colorNode = finalColor;
    mat.side = THREE.BackSide;
    
    (mat as unknown as { userData: { uTime: typeof uTime; uTimeOfDay: typeof uTimeOfDay } }).userData = { uTime, uTimeOfDay };
    
    return mat;
  }, [params.timeOfDay]);
  
  useFrame(({ clock }) => {
    const time = clock.getElapsedTime();
    const userData = (material as unknown as { userData?: { uTime?: { value: number }; uTimeOfDay?: { value: number } } }).userData;
    if (userData) {
      if (userData.uTime) userData.uTime.value = time;
      if (userData.uTimeOfDay) userData.uTimeOfDay.value = params.timeOfDay;
    }
  });
  
  return <mesh ref={meshRef} geometry={geometry} material={material} />;
}

/**
 * Ground plane with terrain
 */
function Ground({ params: _params }: { params: TornadoParams }) {
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(10000, 10000, 100, 100);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, []);
  
  const material = useMemo(() => {
    const mat = new THREE.MeshBasicNodeMaterial();
    
    const uTime = TSL.uniform(0.0);
    
    const worldPos = TSL.positionWorld;
    
    // Distance-based coloring
    const dist = TSL.length(worldPos.xz);
    
    // Ground colors - flat farmland typical of tornado country
    const disturbedGround = TSL.vec3(0.30, 0.25, 0.18); // Churned dirt near tornado
    const dryGrass = TSL.vec3(0.35, 0.38, 0.22);        // Tan/brown grass
    const greenGrass = TSL.vec3(0.25, 0.32, 0.18);      // Darker green patches
    
    // Multi-scale noise for natural variation
    const noise1 = simplex3D(worldPos.mul(0.005)).mul(0.5).add(0.5);
    const noise2 = simplex3D(worldPos.mul(0.02)).mul(0.5).add(0.5);
    const combinedNoise = noise1.mul(0.7).add(noise2.mul(0.3));
    
    // Mix grass colors based on noise
    const grassColor = TSL.mix(dryGrass, greenGrass, combinedNoise);
    
    // Distance from tornado - disturbed zone
    const disturbedZone = TSL.smoothstep(TSL.float(400.0), TSL.float(100.0), dist);
    const groundColor = TSL.mix(grassColor, disturbedGround, disturbedZone);
    
    // Add variation
    const colorVar = combinedNoise.mul(0.08).sub(0.04);
    const variedColor = groundColor.add(TSL.vec3(colorVar, colorVar, colorVar));
    
    // Darkening under storm (reduced ambient light)
    const stormShadow = TSL.float(0.7); // Everything darker under storm
    const tornadoShadow = TSL.smoothstep(TSL.float(300.0), TSL.float(80.0), dist).mul(0.2);
    const darkened = variedColor.mul(stormShadow.sub(tornadoShadow));
    
    mat.colorNode = darkened;
    
    (mat as unknown as { userData: { uTime: typeof uTime } }).userData = { uTime };
    
    return mat;
  }, []);
  
  return <mesh geometry={geometry} material={material} receiveShadow />;
}

/**
 * Fog/haze layer for depth
 */
function AtmosphericFog({ params: _params, tornadoPosition }: AtmosphereEffectsProps) {
  const groupRef = useRef<THREE.Group>(null);
  
  // Create multiple fog layers at different heights
  const fogLayers = useMemo(() => {
    const layers = [];
    const layerCount = 3;
    
    for (let i = 0; i < layerCount; i++) {
      const height = 50 + i * 100;
      const size = 2000 + i * 500;
      const opacity = 0.1 - i * 0.02;
      
      layers.push({ height, size, opacity });
    }
    
    return layers;
  }, []);
  
  const material = useMemo(() => {
    const mat = new THREE.MeshBasicNodeMaterial();
    
    const uTime = TSL.uniform(0.0);
    
    const worldPos = TSL.positionWorld;
    const dist = TSL.length(worldPos.xz);
    
    // Fog color
    const fogColor = TSL.vec3(0.4, 0.42, 0.45);
    
    // Noise for movement
    const noise = simplex3D(worldPos.mul(0.002).add(TSL.vec3(uTime.mul(0.05), 0.0, 0.0)));
    
    // Opacity fades with distance
    const fade = TSL.smoothstep(TSL.float(2000.0), TSL.float(500.0), dist);
    const opacity = fade.mul(noise.mul(0.5).add(0.5)).mul(0.15);
    
    mat.colorNode = fogColor;
    mat.opacityNode = opacity;
    mat.transparent = true;
    mat.depthWrite = false;
    mat.side = THREE.DoubleSide;
    
    (mat as unknown as { userData: { uTime: typeof uTime } }).userData = { uTime };
    
    return mat;
  }, []);
  
  useFrame(({ clock }) => {
    const time = clock.getElapsedTime();
    const userData = (material as unknown as { userData?: { uTime?: { value: number } } }).userData;
    if (userData?.uTime) {
      userData.uTime.value = time;
    }
  });
  
  return (
    <group ref={groupRef}>
      {fogLayers.map((layer) => (
        <mesh key={`fog-${layer.height}`} position={[tornadoPosition.x, layer.height, tornadoPosition.z]}>
          <planeGeometry args={[layer.size, layer.size]} />
          <primitive object={material} attach="material" />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Lightning flash effect
 */
function Lightning({ params, tornadoPosition }: AtmosphereEffectsProps) {
  const lightRef = useRef<THREE.PointLight>(null);
  const nextFlashRef = useRef(Math.random() * 5 + 2);
  const flashIntensityRef = useRef(0);
  
  useFrame(({ clock }) => {
    const time = clock.getElapsedTime();
    
    // Random lightning flashes
    if (time > nextFlashRef.current) {
      flashIntensityRef.current = 3 + Math.random() * 5;
      nextFlashRef.current = time + Math.random() * 8 + 3;
    }
    
    // Decay flash
    flashIntensityRef.current *= 0.85;
    
    if (lightRef.current) {
      lightRef.current.intensity = flashIntensityRef.current;
      // Random position in cloud
      if (flashIntensityRef.current > 2) {
        lightRef.current.position.set(
          tornadoPosition.x + (Math.random() - 0.5) * params.coreRadius * 4,
          params.height + Math.random() * 100,
          tornadoPosition.z + (Math.random() - 0.5) * params.coreRadius * 4
        );
      }
    }
  });
  
  return (
    <pointLight
      ref={lightRef}
      color={0xccccff}
      intensity={0}
      distance={3000}
      decay={2}
    />
  );
}

/**
 * Main atmospheric effects component
 * Creates the dramatic storm atmosphere seen in tornado reference photos
 */
export default function AtmosphereEffects({ params, tornadoPosition }: AtmosphereEffectsProps) {
  return (
    <group name="atmosphere-effects">
      {/* Sky dome with dramatic backlit storm */}
      <StormSky params={params} />
      
      {/* Ground plane - farmland */}
      <Ground params={params} />
      
      {/* Wall cloud at top - dark, rotating mesocyclone */}
      <WallCloud params={params} tornadoPosition={tornadoPosition} />
      
      {/* Ground dust effect - radial streaks */}
      <GroundDustRing params={params} tornadoPosition={tornadoPosition} />
      
      {/* Atmospheric fog for depth */}
      <AtmosphericFog params={params} tornadoPosition={tornadoPosition} />
      
      {/* Lightning flashes */}
      <Lightning params={params} tornadoPosition={tornadoPosition} />
      
      {/* STORM LIGHTING - dramatic and dark */}
      
      {/* Very dim ambient - storm blocks most sunlight */}
      <ambientLight intensity={0.15} color={0x667788} />
      
      {/* Backlight from horizon - creates silhouette effect */}
      <directionalLight
        position={[-800, 100, 500]}
        intensity={0.4}
        color={0xffe8c0}
      />
      
      {/* Dim overhead light through storm clouds */}
      <directionalLight
        position={[200, 600, -200]}
        intensity={0.2}
        color={0x99aabb}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={3000}
        shadow-camera-left={-1000}
        shadow-camera-right={1000}
        shadow-camera-top={1000}
        shadow-camera-bottom={-1000}
      />
      
      {/* Faint green-tinted fill light (storm green effect) */}
      <hemisphereLight
        color={0x889988}
        groundColor={0x443322}
        intensity={0.2}
      />
    </group>
  );
}
