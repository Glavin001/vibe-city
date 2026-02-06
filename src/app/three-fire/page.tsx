'use client';

import { useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  VolumetricFire,
  type FlameControls,
  type SmokeControls,
} from '@/components/three/fire/VolumetricFire';

interface ControlSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  formatValue?: (value: number) => string;
  onChange: (value: number) => void;
}

function ControlSlider({
  label,
  value,
  min,
  max,
  step = 0.01,
  formatValue,
  onChange,
}: ControlSliderProps) {
  const displayValue = formatValue ? formatValue(value) : value.toFixed(step < 1 ? 2 : 0);
  return (
    <label className="block space-y-1">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-white/60">
        <span>{label}</span>
        <span className="font-mono text-white/80">{displayValue}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-orange-500"
      />
    </label>
  );
}

interface ColorControlProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

function ColorControl({ label, value, onChange }: ColorControlProps) {
  return (
    <label className="flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-white/60">
      <span>{label}</span>
      <input
        type="color"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-14 cursor-pointer rounded border border-white/20 bg-transparent"
      />
    </label>
  );
}

interface FireCanvasProps {
  flameControls: FlameControls;
  smokeControls: SmokeControls;
  autoRotate: boolean;
}

function FireCanvas({ flameControls, smokeControls, autoRotate }: FireCanvasProps) {
  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      camera={{ position: [10, 5, 11], fov: 45, near: 0.1, far: 80 }}
      gl={{ antialias: true }}
    >
      <color attach="background" args={['#04070f']} />
      <fog attach="fog" args={['#050912', 14, 42]} />
      <ambientLight intensity={0.25} />
      <directionalLight
        castShadow
        position={[6, 12, 6]}
        intensity={2.2}
        color={new THREE.Color('#ffdab1')}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={1}
        shadow-camera-far={40}
        shadow-camera-left={-18}
        shadow-camera-right={18}
        shadow-camera-top={18}
        shadow-camera-bottom={-18}
      />
      <directionalLight position={[-8, 6, -6]} intensity={0.65} color={new THREE.Color('#1b2f66')} />
      <pointLight position={[0, 5, 0]} intensity={1.2} color={new THREE.Color('#ff8b3d')} distance={36} />
      <FireObjects flameControls={flameControls} smokeControls={smokeControls} />
      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        minDistance={6}
        maxDistance={32}
        maxPolarAngle={Math.PI / 2.05}
        target={[0, 1.6, 0]}
        autoRotate={autoRotate}
        autoRotateSpeed={0.35}
      />
    </Canvas>
  );
}

interface FireObjectsProps {
  flameControls: FlameControls;
  smokeControls: SmokeControls;
}

function FireObjects({ flameControls, smokeControls }: FireObjectsProps) {
  const planeSmoke = useMemo(() => ({
    ...smokeControls,
    rise: smokeControls.rise * 0.75,
    size: smokeControls.size * 1.25,
    drift: smokeControls.drift * 0.6,
  }), [smokeControls]);

  const knotSmoke = useMemo(() => ({
    ...smokeControls,
    rise: smokeControls.rise * 1.2,
    drift: smokeControls.drift * 1.25,
    size: smokeControls.size * 0.9,
  }), [smokeControls]);

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.06, 0]} receiveShadow>
        <circleGeometry args={[18, 64]} />
        <meshStandardMaterial color="#05070f" roughness={1} metalness={0} />
      </mesh>

      <group position={[-6.3, 0.1, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[8, 8, 1, 1]} />
          <meshStandardMaterial color="#111622" roughness={0.96} metalness={0.08} />
        </mesh>
        <VolumetricFire
          position={[0, 0.05, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          shape={{ kind: 'plane', width: 8, height: 8 }}
          flameCount={2400}
          smokeCount={900}
          spread={1.55}
          heightSpread={0.35}
          flameControls={flameControls}
          smokeControls={planeSmoke}
        />
      </group>

      <group position={[0, 1.6, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[1.6, 96, 64]} />
          <meshStandardMaterial
            color="#151b2c"
            roughness={0.82}
            metalness={0.18}
            emissive="#1f2538"
            emissiveIntensity={0.18}
          />
        </mesh>
        <VolumetricFire
          shape={{ kind: 'sphere', radius: 1.6 }}
          flameCount={1900}
          smokeCount={620}
          spread={1.0}
          heightSpread={1.08}
          flameControls={flameControls}
          smokeControls={smokeControls}
        />
      </group>

      <group position={[6.3, 1.2, 0]}>
        <mesh castShadow>
          <boxGeometry args={[2.4, 2.4, 2.4]} />
          <meshStandardMaterial
            color="#121827"
            roughness={0.88}
            metalness={0.12}
            emissive="#131b2b"
            emissiveIntensity={0.12}
          />
        </mesh>
        <VolumetricFire
          shape={{ kind: 'box', width: 2.4, height: 2.4, depth: 2.4 }}
          flameCount={1700}
          smokeCount={540}
          spread={0.9}
          heightSpread={1.1}
          flameControls={flameControls}
          smokeControls={smokeControls}
        />
      </group>

      <group position={[0, 1.1, -6.3]}>
        <mesh castShadow rotation={[Math.PI / 2.4, 0, 0]}>
          <torusKnotGeometry args={[1.4, 0.45, 220, 32, 2, 5]} />
          <meshStandardMaterial
            color="#171f33"
            roughness={0.76}
            metalness={0.22}
            emissive="#151d30"
            emissiveIntensity={0.16}
          />
        </mesh>
        <VolumetricFire
          shape={{ kind: 'torus', radius: 1.4, tube: 0.45, tubularSegments: 220, radialSegments: 28, p: 2, q: 5 }}
          flameCount={2100}
          smokeCount={520}
          spread={0.7}
          heightSpread={0.9}
          flameControls={flameControls}
          smokeControls={knotSmoke}
        />
      </group>
    </group>
  );
}

export default function ThreeFirePage() {
  const [flameSpeed, setFlameSpeed] = useState(0.68);
  const [flameRise, setFlameRise] = useState(3.2);
  const [flameSize, setFlameSize] = useState(64);
  const [flameDistortion, setFlameDistortion] = useState(1.15);
  const [flameFlow, setFlameFlow] = useState(0.75);
  const [flameIntensity, setFlameIntensity] = useState(2.35);
  const [flameFlicker, setFlameFlicker] = useState(1.0);
  const [flameOpacity, setFlameOpacity] = useState(0.95);
  const [flameNoise, setFlameNoise] = useState(0.34);
  const [innerColor, setInnerColor] = useState('#ffd6a8');
  const [outerColor, setOuterColor] = useState('#ff5205');

  const [smokeEnabled, setSmokeEnabled] = useState(true);
  const [smokeSpeed, setSmokeSpeed] = useState(0.2);
  const [smokeRise, setSmokeRise] = useState(5.0);
  const [smokeSize, setSmokeSize] = useState(46);
  const [smokeOpacity, setSmokeOpacity] = useState(0.52);
  const [smokeNoise, setSmokeNoise] = useState(0.28);
  const [smokeDrift, setSmokeDrift] = useState(0.7);
  const [smokeColor, setSmokeColor] = useState('#7f8aa1');

  const [autoRotate, setAutoRotate] = useState(true);

  const flameControls = useMemo<FlameControls>(
    () => ({
      speed: flameSpeed,
      rise: flameRise,
      size: flameSize,
      distortion: flameDistortion,
      flow: flameFlow,
      intensity: flameIntensity,
      flicker: flameFlicker,
      opacity: flameOpacity,
      noiseScale: flameNoise,
      innerColor,
      outerColor,
    }),
    [
      flameDistortion,
      flameFlicker,
      flameFlow,
      flameIntensity,
      flameNoise,
      flameOpacity,
      flameRise,
      flameSize,
      flameSpeed,
      innerColor,
      outerColor,
    ],
  );

  const smokeControls = useMemo<SmokeControls>(
    () => ({
      enabled: smokeEnabled,
      speed: smokeSpeed,
      rise: smokeRise,
      size: smokeSize,
      opacity: smokeOpacity,
      noiseScale: smokeNoise,
      drift: smokeDrift,
      color: smokeColor,
    }),
    [smokeColor, smokeDrift, smokeEnabled, smokeNoise, smokeOpacity, smokeRise, smokeSize, smokeSpeed],
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#04050a] via-[#050918] to-[#0a1226] text-gray-100">
      <div className="mx-auto flex max-w-7xl flex-col gap-10 px-6 py-12">
        <header className="space-y-4 text-center lg:text-left">
          <p className="text-sm uppercase tracking-[0.4em] text-orange-400">React Three Fiber</p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
            Volumetric Fire Playground
          </h1>
          <p className="mx-auto max-w-3xl text-base text-white/70 lg:mx-0 lg:text-lg">
            Explore animated volumetric fire attached to a plane, sphere, cube, and torus knot. Tweak
            the shader-driven flames and optional smoke in real time, then orbit around the scene to
            inspect the lighting from every angle.
          </p>
        </header>

        <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-black/40 shadow-2xl">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,#1d253d_0%,transparent_60%)] opacity-70" />
          <div className="relative h-[720px] w-full">
            <FireCanvas flameControls={flameControls} smokeControls={smokeControls} autoRotate={autoRotate} />
            <div className="pointer-events-none absolute inset-0 flex items-start justify-between p-6">
              <div className="pointer-events-auto w-full max-w-xs space-y-4 rounded-2xl bg-black/60 p-4 backdrop-blur">
                <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-orange-300">Flames</h2>
                <ControlSlider label="Speed" value={flameSpeed} min={0.2} max={1.5} step={0.01} onChange={setFlameSpeed} />
                <ControlSlider label="Rise" value={flameRise} min={1.6} max={6} step={0.05} onChange={setFlameRise} />
                <ControlSlider label="Size" value={flameSize} min={30} max={90} step={1} onChange={setFlameSize} />
                <ControlSlider label="Distortion" value={flameDistortion} min={0} max={2.4} step={0.01} onChange={setFlameDistortion} />
                <ControlSlider label="Flow" value={flameFlow} min={0} max={1.5} step={0.01} onChange={setFlameFlow} />
                <ControlSlider label="Intensity" value={flameIntensity} min={1.2} max={3.5} step={0.01} onChange={setFlameIntensity} />
                <ControlSlider label="Flicker" value={flameFlicker} min={0} max={2.5} step={0.01} onChange={setFlameFlicker} />
                <ControlSlider label="Opacity" value={flameOpacity} min={0.3} max={1} step={0.01} onChange={setFlameOpacity} />
                <ControlSlider label="Noise" value={flameNoise} min={0.15} max={0.65} step={0.01} onChange={setFlameNoise} />
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <ColorControl label="Inner" value={innerColor} onChange={setInnerColor} />
                  <ColorControl label="Outer" value={outerColor} onChange={setOuterColor} />
                </div>
              </div>

              <div className="pointer-events-auto hidden max-w-xs space-y-4 rounded-2xl bg-black/55 p-4 backdrop-blur lg:block">
                <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-300">Smoke</h2>
                <label className="flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-white/60">
                  <span>Enabled</span>
                  <input
                    type="checkbox"
                    checked={smokeEnabled}
                    onChange={(event) => setSmokeEnabled(event.target.checked)}
                    className="h-5 w-5 cursor-pointer rounded border border-white/30 bg-black/40 text-orange-500"
                  />
                </label>
                <ControlSlider label="Speed" value={smokeSpeed} min={0.05} max={0.6} step={0.01} onChange={setSmokeSpeed} />
                <ControlSlider label="Rise" value={smokeRise} min={2} max={9} step={0.05} onChange={setSmokeRise} />
                <ControlSlider label="Size" value={smokeSize} min={20} max={80} step={1} onChange={setSmokeSize} />
                <ControlSlider label="Opacity" value={smokeOpacity} min={0.1} max={0.9} step={0.01} onChange={setSmokeOpacity} />
                <ControlSlider label="Noise" value={smokeNoise} min={0.1} max={0.6} step={0.01} onChange={setSmokeNoise} />
                <ControlSlider label="Drift" value={smokeDrift} min={0} max={1.6} step={0.01} onChange={setSmokeDrift} />
                <ColorControl label="Color" value={smokeColor} onChange={setSmokeColor} />
                <label className="mt-2 flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-white/60">
                  <span>Auto Orbit</span>
                  <input
                    type="checkbox"
                    checked={autoRotate}
                    onChange={(event) => setAutoRotate(event.target.checked)}
                    className="h-5 w-5 cursor-pointer rounded border border-white/30 bg-black/40 text-orange-500"
                  />
                </label>
              </div>
            </div>
          </div>
          <div className="pointer-events-none absolute bottom-4 left-0 right-0 mx-auto hidden max-w-md rounded-full border border-white/10 bg-black/50 px-6 py-2 text-center text-xs uppercase tracking-[0.3em] text-white/60 backdrop-blur sm:block">
            Drag with your mouse or touch to orbit the camera around the inferno
          </div>
        </section>

        <section className="grid gap-6 rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur-lg lg:grid-cols-3">
          <div className="space-y-2">
            <h2 className="text-lg font-semibold tracking-tight text-white">Volumetric particles</h2>
            <p className="text-sm text-white/70">
              Thousands of shader-driven point sprites are sampled from each mesh surface, jittered into
              the volume, and animated with procedural simplex noise to produce layered flames that wrap
              any geometry.
            </p>
          </div>
          <div className="space-y-2">
            <h2 className="text-lg font-semibold tracking-tight text-white">Parametric fire shader</h2>
            <p className="text-sm text-white/70">
              The custom GLSL material combines noise-driven distortion, height-based color gradients,
              and flicker controls so the same system can ignite planes, solids, or intricate shapes like
              the torus knot.
            </p>
          </div>
          <div className="space-y-2">
            <h2 className="text-lg font-semibold tracking-tight text-white">Configurable smoke</h2>
            <p className="text-sm text-white/70">
              Optional smoke plumes rise with independent drift, size, and opacity controls to add depth
              and atmosphere without heavy volumetric raymarching.
            </p>
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-4 text-sm text-white/60">
          <a href="/" className="rounded-full border border-white/30 px-4 py-2 transition hover:border-orange-400 hover:text-orange-300">
            ← Back to home
          </a>
          <p className="text-xs uppercase tracking-[0.3em]">
            Built with React Three Fiber · Three.js · Procedural shaders
          </p>
        </div>
      </div>
    </div>
  );
}

