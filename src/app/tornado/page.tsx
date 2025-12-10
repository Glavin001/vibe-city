"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, StatsGl } from "@react-three/drei";
import { Suspense, useState, useCallback } from "react";
import * as THREE from "three/webgpu";

// EF Scale wind speeds (mph converted to m/s for simulation)
const EF_SCALE = [
  { label: "EF0", windSpeed: 29, description: "Light damage" },
  { label: "EF1", windSpeed: 42, description: "Moderate damage" },
  { label: "EF2", windSpeed: 58, description: "Significant damage" },
  { label: "EF3", windSpeed: 74, description: "Severe damage" },
  { label: "EF4", windSpeed: 90, description: "Devastating damage" },
  { label: "EF5", windSpeed: 105, description: "Incredible damage" },
] as const;

export interface TornadoParams {
  intensity: number; // 0-5 (EF scale)
  coreRadius: number; // meters
  height: number; // meters
  translationSpeed: number; // m/s
  turbulence: number; // 0-1
  debrisDensity: number; // 0-1
  timeOfDay: number; // 0-24
  rotationDirection: 1 | -1; // 1 = counter-clockwise (northern hemisphere)
}

const DEFAULT_PARAMS: TornadoParams = {
  intensity: 3,
  coreRadius: 50,
  height: 500,
  translationSpeed: 15,
  turbulence: 0.6,
  debrisDensity: 0.7,
  timeOfDay: 15,
  rotationDirection: 1,
};

interface SliderProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  formatter?: (value: number) => string;
  onChange: (value: number) => void;
}

function Slider({ id, label, value, min, max, step, formatter, onChange }: SliderProps) {
  const displayValue = formatter ? formatter(value) : value.toFixed(step < 1 ? 2 : 0);
  return (
    <div className="mb-4">
      <div className="mb-1 flex justify-between text-xs">
        <label htmlFor={id}>{label}</label>
        <span className="font-mono text-neutral-400">{displayValue}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-neutral-700 accent-white"
      />
    </div>
  );
}

interface ControlPanelProps {
  params: TornadoParams;
  onParamsChange: (params: Partial<TornadoParams>) => void;
}

function ControlPanel({ params, onParamsChange }: ControlPanelProps) {
  const efInfo = EF_SCALE[params.intensity];
  
  return (
    <div className="pointer-events-auto absolute bottom-6 right-6 z-10 w-80 max-h-[80vh] overflow-y-auto rounded-xl border border-white/10 bg-black/80 p-6 text-white shadow-2xl backdrop-blur-md">
      {/* Intensity Section */}
      <section>
        <h2 className="mb-4 border-b border-white/10 pb-2 text-sm font-bold uppercase tracking-widest text-neutral-400">
          Intensity
        </h2>
        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-2xl font-bold text-red-500">{efInfo.label}</span>
            <span className="text-xs text-neutral-400">{efInfo.description}</span>
          </div>
          <div className="mb-2 text-xs text-neutral-500">
            Max wind: ~{Math.round(efInfo.windSpeed * 2.237)} mph ({efInfo.windSpeed} m/s)
          </div>
          <div className="grid grid-cols-6 gap-1">
            {EF_SCALE.map((ef, i) => (
              <button
                key={ef.label}
                type="button"
                onClick={() => onParamsChange({ intensity: i })}
                className={`py-2 text-xs rounded border transition-all ${
                  params.intensity === i
                    ? "border-red-500 bg-red-500/30 text-white"
                    : "border-neutral-600 text-neutral-400 hover:border-neutral-400"
                }`}
              >
                {ef.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Vortex Parameters */}
      <section className="mt-6">
        <h2 className="mb-4 border-b border-white/10 pb-2 text-sm font-bold uppercase tracking-widest text-neutral-400">
          Vortex Parameters
        </h2>
        <Slider
          id="coreRadius"
          label="Core Radius"
          value={params.coreRadius}
          min={10}
          max={150}
          step={5}
          formatter={(v) => `${v}m`}
          onChange={(v) => onParamsChange({ coreRadius: v })}
        />
        <Slider
          id="height"
          label="Funnel Height"
          value={params.height}
          min={100}
          max={2000}
          step={50}
          formatter={(v) => `${v}m`}
          onChange={(v) => onParamsChange({ height: v })}
        />
        <Slider
          id="translationSpeed"
          label="Translation Speed"
          value={params.translationSpeed}
          min={0}
          max={40}
          step={1}
          formatter={(v) => `${v} m/s`}
          onChange={(v) => onParamsChange({ translationSpeed: v })}
        />
        <div className="mb-4">
          <div className="mb-2 text-xs">Rotation Direction</div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onParamsChange({ rotationDirection: 1 })}
              className={`py-2 text-xs rounded border ${
                params.rotationDirection === 1
                  ? "border-white bg-white text-black"
                  : "border-neutral-600 text-neutral-400 hover:border-neutral-400"
              }`}
            >
              ↺ Counter-CW
            </button>
            <button
              type="button"
              onClick={() => onParamsChange({ rotationDirection: -1 })}
              className={`py-2 text-xs rounded border ${
                params.rotationDirection === -1
                  ? "border-white bg-white text-black"
                  : "border-neutral-600 text-neutral-400 hover:border-neutral-400"
              }`}
            >
              ↻ Clockwise
            </button>
          </div>
        </div>
      </section>

      {/* Visual Effects */}
      <section className="mt-6">
        <h2 className="mb-4 border-b border-white/10 pb-2 text-sm font-bold uppercase tracking-widest text-neutral-400">
          Visual Effects
        </h2>
        <Slider
          id="turbulence"
          label="Turbulence"
          value={params.turbulence}
          min={0}
          max={1}
          step={0.05}
          formatter={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => onParamsChange({ turbulence: v })}
        />
        <Slider
          id="debrisDensity"
          label="Debris Density"
          value={params.debrisDensity}
          min={0}
          max={1}
          step={0.05}
          formatter={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => onParamsChange({ debrisDensity: v })}
        />
        <Slider
          id="timeOfDay"
          label="Time of Day"
          value={params.timeOfDay}
          min={0}
          max={24}
          step={0.5}
          formatter={(v) => {
            const hours = Math.floor(v);
            const minutes = Math.round((v - hours) * 60);
            return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
          }}
          onChange={(v) => onParamsChange({ timeOfDay: v })}
        />
      </section>

      {/* Physics Info */}
      <section className="mt-6">
        <h2 className="mb-4 border-b border-white/10 pb-2 text-sm font-bold uppercase tracking-widest text-neutral-400">
          Physics Info
        </h2>
        <div className="space-y-1 text-xs text-neutral-500">
          <p><span className="text-neutral-400">Model:</span> Rankine Combined Vortex</p>
          <p><span className="text-neutral-400">V_tangential:</span> Solid body core + irrotational outer</p>
          <p><span className="text-neutral-400">Updraft:</span> Central column with radial inflow</p>
          <p><span className="text-neutral-400">Turbulence:</span> 3D Curl noise field</p>
        </div>
      </section>
    </div>
  );
}

// Lazy load the TornadoScene component
import dynamic from "next/dynamic";
const TornadoScene = dynamic(() => import("@/components/tornado/TornadoScene"), {
  ssr: false,
  loading: () => null,
});

export default function TornadoPage() {
  const [params, setParams] = useState<TornadoParams>(DEFAULT_PARAMS);
  
  const handleParamsChange = useCallback((changes: Partial<TornadoParams>) => {
    setParams((prev) => ({ ...prev, ...changes }));
  }, []);

  return (
    <div className="relative min-h-screen w-full select-none bg-neutral-900 font-sans text-white">
      <div className="absolute inset-0">
        <Canvas
          camera={{ position: [300, 150, 300], fov: 60, near: 1, far: 10000 }}
          gl={async (props) => {
            const renderer = new THREE.WebGPURenderer({
              ...props,
              antialias: true,
            } as Parameters<typeof THREE.WebGPURenderer>[0]);
            await renderer.init();
            return renderer as unknown as THREE.WebGLRenderer;
          }}
        >
          <Suspense fallback={null}>
            <TornadoScene params={params} />
          </Suspense>
          <OrbitControls
            target={[0, 200, 0]}
            minDistance={100}
            maxDistance={2000}
            maxPolarAngle={Math.PI / 2 - 0.1}
            enableDamping
          />
          <StatsGl className="absolute top-4 left-4" />
        </Canvas>
      </div>

      {/* Header */}
      <div className="relative z-10 min-h-screen pointer-events-none">
        <div className="absolute left-0 top-0 flex w-full items-start justify-between p-6 text-left">
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-neutral-200 drop-shadow-md">
              Tornado Simulation
            </h1>
            <p className="mt-2 max-w-xl rounded-lg border border-white/10 bg-black/60 p-4 text-sm text-neutral-400 shadow-xl backdrop-blur-md">
              <strong>Physics Model:</strong> Rankine Combined Vortex with real-time GPU computation.
              <br />
              <strong>Features:</strong> Volumetric funnel, multi-layer debris system, atmospheric effects.
              <br />
              <strong>Controls:</strong> Orbit with mouse, adjust parameters in the control panel.
            </p>
          </div>
        </div>

        <ControlPanel params={params} onParamsChange={handleParamsChange} />

        <div className="pointer-events-none absolute bottom-6 left-6">
          <p className="font-mono text-xs uppercase tracking-widest text-neutral-500">
            Three.js / WebGPU TSL Compute
          </p>
        </div>
      </div>
    </div>
  );
}
