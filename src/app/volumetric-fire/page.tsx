"use client";

import { Suspense, useMemo, useState, type ChangeEvent } from "react";
import { Canvas } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { DoubleSide } from "three";

import { VolumetricFire } from "@/components/three/VolumetricFire";
import { SmokePlume } from "@/components/three/SmokePlume";

type FireConfig = {
  noiseX: number;
  noiseY: number;
  noiseZ: number;
  speed: number;
  magnitude: number;
  lacunarity: number;
  gain: number;
  intensity: number;
  color: string;
  smoke: number;
};

const defaultConfig: FireConfig = {
  noiseX: 1.0,
  noiseY: 2.6,
  noiseZ: 1.0,
  speed: 0.42,
  magnitude: 1.45,
  lacunarity: 2.15,
  gain: 0.48,
  intensity: 2.35,
  color: "#ffb567",
  smoke: 0.6,
};

type NumericKey = Exclude<keyof FireConfig, "color">;

const toNoiseScale = (config: FireConfig) =>
  [config.noiseX, config.noiseY, config.noiseZ, config.speed] as [
    number,
    number,
    number,
    number,
  ];

function ControlPanel({
  config,
  onChange,
}: {
  config: FireConfig;
  onChange: (partial: Partial<FireConfig>) => void;
}) {
  const handleRangeChange = (key: NumericKey) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      onChange({ [key]: Number.parseFloat(event.currentTarget.value) } as Partial<FireConfig>);
    };

  const range = (
    label: string,
    key: NumericKey,
    min: number,
    max: number,
    step: number,
    formatter: (value: number) => string = (value) => value.toFixed(2),
  ) => (
    <label key={key} className="block space-y-1">
      <div className="flex items-center justify-between text-xs uppercase tracking-wide text-gray-300">
        <span>{label}</span>
        <span className="font-semibold text-gray-100">{formatter(config[key])}</span>
      </div>
      <input
        className="w-full cursor-pointer accent-orange-500"
        type="range"
        min={min}
        max={max}
        step={step}
        value={config[key]}
        onChange={handleRangeChange(key)}
      />
    </label>
  );

  return (
    <div className="pointer-events-none absolute inset-0 flex justify-end p-6">
      <div className="pointer-events-auto w-72 rounded-xl bg-black/70 p-4 text-gray-100 shadow-xl backdrop-blur">
        <h2 className="text-lg font-semibold text-white">Fire Controls</h2>
        <p className="mt-1 text-xs text-gray-300">
          Tweak the turbulence, speed, and intensity of the volumetric flames.
        </p>
        <div className="mt-4 space-y-3">
          {range("Rise Speed", "speed", 0.1, 1.0, 0.01, (value) => value.toFixed(2))}
          {range("Noise Stretch X", "noiseX", 0.4, 2.0, 0.01)}
          {range("Noise Stretch Y", "noiseY", 0.8, 4.0, 0.05)}
          {range("Noise Stretch Z", "noiseZ", 0.4, 2.0, 0.01)}
          {range("Turbulence Magnitude", "magnitude", 0.6, 2.5, 0.01)}
          {range("Lacunarity", "lacunarity", 1.2, 3.2, 0.01)}
          {range("Gain", "gain", 0.25, 0.9, 0.01)}
          {range("Brightness", "intensity", 0.5, 3.5, 0.01)}
          {range("Smoke Density", "smoke", 0.0, 1.0, 0.01, (value) => value.toFixed(2))}
        </div>
        <label className="mt-4 block text-xs uppercase tracking-wide text-gray-300">
          Flame Palette
          <input
            type="color"
            value={config.color}
            onChange={(event) => onChange({ color: event.currentTarget.value })}
            className="mt-1 h-9 w-full cursor-pointer rounded border border-white/20 bg-transparent"
          />
        </label>
      </div>
    </div>
  );
}

interface BurningProps {
  config: FireConfig;
  noiseScale: [number, number, number, number];
  smokeOpacity: number;
  smokeRise: number;
}

function BurningPlane({ config, noiseScale, smokeOpacity, smokeRise }: BurningProps) {
  const frameWidth = 6.2;
  const frameHeight = 4.2;

  return (
    <group position={[-15, 2.3, -5]} rotation={[0, Math.PI / 9, 0]}>
      <mesh castShadow receiveShadow>
        <planeGeometry args={[frameWidth, frameHeight]} />
        <meshStandardMaterial
          color="#1d1d21"
          metalness={0.15}
          roughness={0.85}
          side={DoubleSide}
        />
      </mesh>
      <VolumetricFire
        size={[frameWidth * 1.05, frameHeight * 1.1, 0.9]}
        shape="plane"
        shapeParams={[0.12, 0, 0.35, 0]}
        noiseScale={noiseScale}
        magnitude={config.magnitude}
        lacunarity={config.lacunarity}
        gain={config.gain}
        intensity={config.intensity}
        color={config.color}
      />
      <SmokePlume
        position={[0, frameHeight * 0.55, 0]}
        spread={2.5}
        height={5.2}
        riseSpeed={smokeRise}
        opacity={smokeOpacity * 0.9}
        size={60}
        curlStrength={0.45}
        color="#b9bec9"
      />
      <Html
        position={[0, -frameHeight * 0.6, 0]}
        center
        className="rounded-full bg-black/70 px-3 py-1 text-xs font-medium text-gray-200 shadow"
      >
        Flame Wall
      </Html>
    </group>
  );
}

function BurningCube({ config, noiseScale, smokeOpacity, smokeRise }: BurningProps) {
  const cubeSize = 2.2;

  return (
    <group position={[-7.5, 1.6, 5.6]}>
      <mesh castShadow receiveShadow scale={[cubeSize, cubeSize, cubeSize]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#242830" metalness={0.3} roughness={0.4} />
      </mesh>
      <VolumetricFire
        size={[cubeSize * 1.15, cubeSize * 1.15, cubeSize * 1.15]}
        shape="box"
        shapeParams={[1, 1, 0.5, 0]}
        noiseScale={noiseScale}
        magnitude={config.magnitude}
        lacunarity={config.lacunarity}
        gain={config.gain}
        intensity={config.intensity}
        color={config.color}
      />
      <SmokePlume
        position={[0, cubeSize * 0.9, 0]}
        spread={1.2}
        height={4.2}
        riseSpeed={smokeRise}
        opacity={smokeOpacity}
        size={44}
        curlStrength={0.38}
        color="#bfc4cc"
      />
      <Html
        position={[0, -cubeSize * 1.1, 0]}
        center
        className="rounded-full bg-black/70 px-3 py-1 text-xs font-medium text-gray-200 shadow"
      >
        Cube
      </Html>
    </group>
  );
}

function BurningCylinder({ config, noiseScale, smokeOpacity, smokeRise }: BurningProps) {
  const radius = 1.3;
  const height = 3.4;

  return (
    <group position={[0, height * 0.42, -6.3]}>
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[radius, radius, height, 64]} />
        <meshStandardMaterial color="#20242b" metalness={0.25} roughness={0.5} />
      </mesh>
      <VolumetricFire
        size={[radius * 2.4, height * 1.05, radius * 2.4]}
        shape="cylinder"
        shapeParams={[0.95, 1.05, 0.4, 0]}
        noiseScale={noiseScale}
        magnitude={config.magnitude}
        lacunarity={config.lacunarity}
        gain={config.gain}
        intensity={config.intensity}
        color={config.color}
      />
      <SmokePlume
        position={[0, height * 0.6, 0]}
        spread={1.5}
        height={5.0}
        riseSpeed={smokeRise * 1.05}
        opacity={smokeOpacity * 1.05}
        size={55}
        curlStrength={0.42}
        color="#c6cad1"
      />
      <Html
        position={[0, -height * 0.65, 0]}
        center
        className="rounded-full bg-black/70 px-3 py-1 text-xs font-medium text-gray-200 shadow"
      >
        Cylinder
      </Html>
    </group>
  );
}

function BurningSphere({ config, noiseScale, smokeOpacity, smokeRise }: BurningProps) {
  const radius = 1.4;

  return (
    <group position={[7.8, radius * 0.95, 4.8]}>
      <mesh castShadow receiveShadow>
        <sphereGeometry args={[radius, 64, 32]} />
        <meshStandardMaterial color="#1f242b" metalness={0.2} roughness={0.45} />
      </mesh>
      <VolumetricFire
        size={[radius * 2.4, radius * 2.4, radius * 2.4]}
        shape="sphere"
        shapeParams={[0.98, 0, 0.45, 0]}
        noiseScale={noiseScale}
        magnitude={config.magnitude}
        lacunarity={config.lacunarity}
        gain={config.gain}
        intensity={config.intensity}
        color={config.color}
      />
      <SmokePlume
        position={[0, radius * 1.4, 0]}
        spread={1.6}
        height={4.4}
        riseSpeed={smokeRise * 1.1}
        opacity={smokeOpacity * 0.85}
        size={48}
        curlStrength={0.4}
        color="#c3c8cf"
      />
      <Html
        position={[0, -radius * 1.4, 0]}
        center
        className="rounded-full bg-black/70 px-3 py-1 text-xs font-medium text-gray-200 shadow"
      >
        Sphere
      </Html>
    </group>
  );
}

function BurningTorus({ config, noiseScale, smokeOpacity, smokeRise }: BurningProps) {
  const major = 1.6;
  const tube = 0.45;

  return (
    <group position={[15, 1.8, -2.3]}>
      <mesh castShadow receiveShadow>
        <torusGeometry args={[major, tube, 64, 128]} />
        <meshStandardMaterial color="#232831" metalness={0.28} roughness={0.4} />
      </mesh>
      <VolumetricFire
        size={[major * 2.6, (tube + major * 0.6) * 1.6, major * 2.6]}
        shape="torus"
        shapeParams={[0.6, 0.32, 0.3, 0]}
        noiseScale={noiseScale}
        magnitude={config.magnitude}
        lacunarity={config.lacunarity}
        gain={config.gain}
        intensity={config.intensity}
        color={config.color}
      />
      <SmokePlume
        position={[0, tube * 4.0, 0]}
        spread={2.1}
        height={4.8}
        riseSpeed={smokeRise * 0.95}
        opacity={smokeOpacity * 0.9}
        size={52}
        curlStrength={0.48}
        color="#c0c5cc"
      />
      <Html
        position={[0, -(tube + major * 0.8), 0]}
        center
        className="rounded-full bg-black/70 px-3 py-1 text-xs font-medium text-gray-200 shadow"
      >
        Torus
      </Html>
    </group>
  );
}

function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} receiveShadow>
      <planeGeometry args={[160, 160]} />
      <meshStandardMaterial color="#050608" roughness={0.95} metalness={0.05} />
    </mesh>
  );
}

function FireScene({ config }: { config: FireConfig }) {
  const noiseScale = useMemo(
    () => toNoiseScale(config),
    [config.noiseX, config.noiseY, config.noiseZ, config.speed],
  );
  const smokeOpacity = useMemo(() => 0.25 + config.smoke * 0.55, [config.smoke]);
  const smokeRise = useMemo(() => 2.2 + config.speed * 3.4, [config.speed]);

  return (
    <>
      <color attach="background" args={["#050608"]} />
      <fog attach="fog" args={["#050608", 18, 90]} />
      <ambientLight intensity={0.28} />
      <directionalLight
        position={[16, 18, 12]}
        intensity={1.4}
        color="#fff3d1"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <directionalLight position={[-18, 12, -16]} intensity={0.45} color="#3b4c6a" />
      <pointLight position={[0, 5.4, 0]} intensity={2.2} distance={48} color={config.color} />

      <Ground />

      <BurningPlane
        config={config}
        noiseScale={noiseScale}
        smokeOpacity={smokeOpacity}
        smokeRise={smokeRise}
      />
      <BurningCube
        config={config}
        noiseScale={noiseScale}
        smokeOpacity={smokeOpacity}
        smokeRise={smokeRise}
      />
      <BurningCylinder
        config={config}
        noiseScale={noiseScale}
        smokeOpacity={smokeOpacity}
        smokeRise={smokeRise}
      />
      <BurningSphere
        config={config}
        noiseScale={noiseScale}
        smokeOpacity={smokeOpacity}
        smokeRise={smokeRise}
      />
      <BurningTorus
        config={config}
        noiseScale={noiseScale}
        smokeOpacity={smokeOpacity}
        smokeRise={smokeRise}
      />

      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        minDistance={8}
        maxDistance={45}
        target={[0, 1.6, 0]}
      />
    </>
  );
}

export default function VolumetricFirePage() {
  const [config, setConfig] = useState<FireConfig>(defaultConfig);

  const handleChange = (partial: Partial<FireConfig>) => {
    setConfig((prev) => ({ ...prev, ...partial }));
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="relative h-[720px] w-full">
        <Canvas camera={{ position: [0, 6, 24], fov: 50 }} shadows dpr={[1, 1.5]}>
          <Suspense fallback={null}>
            <FireScene config={config} />
          </Suspense>
        </Canvas>
        <ControlPanel config={config} onChange={handleChange} />
      </div>

      <section className="mx-auto max-w-5xl px-6 py-12">
        <h1 className="text-4xl font-semibold text-white">Volumetric Fire Playground</h1>
        <p className="mt-4 text-lg text-gray-300">
          Explore a modernized volumetric fire shader based on ray-marched turbulence. The scene
          showcases fire that conforms to drastically different meshes, from thin planes to dense
          toruses, while orbit controls let you inspect the animation from every angle.
        </p>
        <ul className="mt-6 space-y-2 text-gray-300">
          <li>
            <span className="font-semibold text-white">Volumetric flames:</span> A ray-marched
            shader with multi-octave simplex noise feeds a color ramp to produce believable flames
            that hug the silhouette of each object.
          </li>
          <li>
            <span className="font-semibold text-white">Shape-aware masking:</span> Fire volumes
            adapt to planes, boxes, spheres, cylinders, and toruses with signed-distance masks so
            each mesh appears naturally engulfed.
          </li>
          <li>
            <span className="font-semibold text-white">Dynamic smoke:</span> Lightweight point
            sprites add a curling smoke plume for every piece, matching the configurable burn
            density.
          </li>
          <li>
            <span className="font-semibold text-white">Live controls:</span> Adjust turbulence,
            rise speed, color temperature, and brightness with the inline control panel to dial in
            different fire personalities.
          </li>
        </ul>
        <div className="mt-8">
          <a
            href="/"
            className="inline-flex items-center rounded-full bg-orange-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-500"
          >
            ← Back to home
          </a>
        </div>
      </section>
    </div>
  );
}

