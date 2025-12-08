"use client";

import { useCallback, useMemo, useState } from "react";
import Scene from "@/components/gpgpu-dust/Scene";

const RESOLUTION_PRESETS = [
  { label: "Low (4k)", value: 64 },
  { label: "Med (16k)", value: 128 },
  { label: "High (65k)", value: 256 },
] as const;

type SliderConfig = {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  formatter: (value: number) => string;
  onChange: (value: number) => void;
};

type SliderGroup = {
  title: string;
  sliders: SliderConfig[];
};

interface ControlPanelProps {
  resolution: number;
  onResolutionChange: (value: number) => void;
  particleCount: string;
  sliderGroups: SliderGroup[];
}

type ControlSliderProps = SliderConfig;

const ControlSlider = ({ id, label, value, min, max, step, formatter, onChange }: ControlSliderProps) => (
  <div className="mb-4">
    <div className="mb-1 flex justify-between text-xs">
      <label htmlFor={id}>{label}</label>
      <span className="font-mono text-neutral-400">{formatter(value)}</span>
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

const ControlPanel = ({ resolution, onResolutionChange, particleCount, sliderGroups }: ControlPanelProps) => (
  <div className="pointer-events-auto absolute bottom-6 right-6 z-10 w-80 max-h-[80vh] overflow-y-auto rounded-xl border border-white/10 bg-black/80 p-6 text-white shadow-2xl backdrop-blur-md">
    <h2 className="mb-4 border-b border-white/10 pb-2 text-sm font-bold uppercase tracking-widest text-neutral-400">Performance</h2>
    <div className="mb-4">
      <div className="mb-2 flex justify-between text-xs">
        <span>Particle Count</span>
        <span className="font-mono text-neutral-400">{particleCount}</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {RESOLUTION_PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            className={`text-xs py-1 rounded border ${
              resolution === preset.value
                ? "border-white bg-white text-black"
                : "border-neutral-600 text-neutral-400 hover:border-neutral-400"
            }`}
            onClick={() => onResolutionChange(preset.value)}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[10px] leading-tight text-neutral-500">
        Use Low/Med for large clouds to prevent lag. Use High for small, gritty debris.
      </p>
    </div>

    {sliderGroups.map((group) => (
      <section key={group.title} className="mt-6">
        <h2 className="mb-4 border-b border-white/10 pb-2 text-sm font-bold uppercase tracking-widest text-neutral-400">
          {group.title}
        </h2>
        {group.sliders.map((slider) => (
          <ControlSlider key={slider.id} {...slider} />
        ))}
      </section>
    ))}
  </div>
);

const formatDefault = (value: number) => {
  const formatted = value.toFixed(2);
  return formatted.replace(/\.?0+$/, "");
};

export default function GPUDustPage() {
  const [trigger, setTrigger] = useState(0);

  // Physics
  const [gravity, setGravity] = useState(4.0);
  const [drag, setDrag] = useState(0.98);
  const [turbulence, setTurbulence] = useState(3.0);

  // Scene
  const [lifeTime, setLifeTime] = useState(1.5);
  const [roofHeight, setRoofHeight] = useState(10.0);
  const [vehicleSpeed, setVehicleSpeed] = useState(15.0);

  // Visuals
  const [opacity, setOpacity] = useState(0.3);
  const [size, setSize] = useState(1.0);
  const [detail, setDetail] = useState(3.0);
  const [brightness, setBrightness] = useState(1.0);
  const [resolution, setResolution] = useState(128);

  const sliderGroups = useMemo<SliderGroup[]>(() => {
    const sliders: SliderGroup[] = [
      {
        title: "Scene Controls",
        sliders: [
          {
            id: "lifeTime",
            label: "Dust Duration",
            value: lifeTime,
            min: 0.5,
            max: 5.0,
            step: 0.1,
            formatter: (value: number) => `x${value.toFixed(1)}`,
            onChange: setLifeTime,
          },
          {
            id: "roofHeight",
            label: "Roof Height",
            value: roofHeight,
            min: 5.0,
            max: 25.0,
            step: 0.5,
            formatter: (value: number) => `${value.toFixed(1)}m`,
            onChange: setRoofHeight,
          },
          {
            id: "vehicleSpeed",
            label: "Vehicle Speed",
            value: vehicleSpeed,
            min: 0,
            max: 60,
            step: 1,
            formatter: (value: number) => `${value.toFixed(0)} km/h`,
            onChange: setVehicleSpeed,
          },
        ],
      },
      {
        title: "Physics Controls",
        sliders: [
          {
            id: "gravity",
            label: "Gravity",
            value: gravity,
            min: 0,
            max: 20,
            step: 0.1,
            formatter: (value: number) => value.toFixed(1),
            onChange: setGravity,
          },
          {
            id: "drag",
            label: "Air Resistance (Drag)",
            value: drag,
            min: 0.8,
            max: 0.999,
            step: 0.001,
            formatter: (value: number) => value.toFixed(3),
            onChange: setDrag,
          },
          {
            id: "turbulence",
            label: "Turbulence (Curl Noise)",
            value: turbulence,
            min: 0,
            max: 20,
            step: 0.1,
            formatter: (value: number) => value.toFixed(1),
            onChange: setTurbulence,
          },
        ],
      },
      {
        title: "Visual Controls",
        sliders: [
          {
            id: "opacity",
            label: "Cloud Density",
            value: opacity,
            min: 0.05,
            max: 1.0,
            step: 0.05,
            formatter: (value: number) => `${Math.round(value * 100)}%`,
            onChange: setOpacity,
          },
          {
            id: "size",
            label: "Puff Size",
            value: size,
            min: 0.1,
            max: 3.0,
            step: 0.1,
            formatter: (value: number) => `x${value.toFixed(1)}`,
            onChange: setSize,
          },
          {
            id: "detail",
            label: "Texture Detail",
            value: detail,
            min: 1.0,
            max: 10.0,
            step: 0.5,
            formatter: (value: number) => value.toFixed(1),
            onChange: setDetail,
          },
          {
            id: "brightness",
            label: "Brightness",
            value: brightness,
            min: 0.1,
            max: 3.0,
            step: 0.1,
            formatter: formatDefault,
            onChange: setBrightness,
          },
        ],
      },
    ];
    return sliders;
  }, [lifeTime, roofHeight, vehicleSpeed, gravity, drag, turbulence, opacity, size, detail, brightness]);

  const handleExplosion = useCallback(() => {
    setTrigger((prev) => prev + 1);
  }, []);

  const particleCount = useMemo(() => (resolution * resolution).toLocaleString(), [resolution]);

  return (
    <div className="relative min-h-screen w-full select-none bg-neutral-900 font-sans text-white">
      <div className="absolute inset-0">
        <Scene
          trigger={trigger}
          gravity={gravity}
          drag={drag}
          turbulence={turbulence}
          opacity={opacity}
          size={size}
          detail={detail}
          brightness={brightness}
          resolution={resolution}
          lifeTime={lifeTime}
          roofHeight={roofHeight}
          vehicleSpeed={vehicleSpeed}
        />
      </div>

      <div className="relative z-10 min-h-screen">
        <div className="pointer-events-none absolute left-0 top-0 flex w-full items-start justify-between p-6 text-left">
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-neutral-200 drop-shadow-md">
              GPGPU Data-Texture Physics
            </h1>
            <p className="mt-2 max-w-xl rounded-lg border border-white/10 bg-black/60 p-4 text-sm text-neutral-400 shadow-xl backdrop-blur-md">
              <strong>Scenario:</strong> A dynamic vehicle driving through a volumetric dust explosion.
              <br />
              <strong>Physics Engine:</strong> The cyan truck is a kinematic body synced to the GPU via data textures every frame.
              <br />
              <strong>Interaction:</strong> Watch how dust curls around red barriers, gets trapped under the blue roof, and responds to the moving truck.
              <br />
              <br />
              <em>Tip: Lower resolution runs faster when the puff size is large.</em>
            </p>
          </div>
          <div className="pointer-events-auto flex flex-col items-end gap-4">
            <button
              onClick={handleExplosion}
              type="button"
              className="rounded-full bg-white px-8 py-3 font-bold text-neutral-900 shadow-lg shadow-white/10 transition-all duration-200 hover:scale-105 hover:bg-neutral-200 active:scale-95"
            >
              Detonate
            </button>
          </div>
        </div>

        <ControlPanel
          resolution={resolution}
          onResolutionChange={setResolution}
          particleCount={particleCount}
          sliderGroups={sliderGroups}
        />

        <div className="pointer-events-none absolute bottom-6 left-6">
          <p className="font-mono text-xs uppercase tracking-widest text-neutral-500">Three.js / GPUComputationRenderer</p>
        </div>
      </div>
    </div>
  );
}


