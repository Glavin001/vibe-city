"use client";

/**
 * Fire Propagation Demo Page
 *
 * Interactive fire simulation with temperature, moisture, and fuel dynamics.
 * Inspired by Far Cry 2's fire propagation system, enhanced with a dual-axis state model.
 */

import { Canvas } from "@react-three/fiber";
import { Suspense, useState, useCallback } from "react";
import {
  type WindParams,
  type SimulationParams,
  type GridPreset,
  InteractionTool,
  MaterialType,
  DEFAULT_WIND,
  DEFAULT_SIMULATION,
} from "@/lib/fire-propagation/types";
import { FireScene } from "@/components/fire-propagation/FireScene";

// ============================================================================
// UI Components
// ============================================================================

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

function Slider({
  id,
  label,
  value,
  min,
  max,
  step,
  formatter,
  onChange,
}: SliderProps) {
  const displayValue = formatter
    ? formatter(value)
    : value.toFixed(step < 1 ? 2 : 0);
  return (
    <div className="mb-3">
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
        className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-neutral-700 accent-orange-500"
      />
    </div>
  );
}

interface ButtonGroupProps<T extends string> {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

function ButtonGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: ButtonGroupProps<T>) {
  return (
    <div className="mb-3">
      <div className="mb-2 text-xs text-neutral-400">{label}</div>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.min(options.length, 4)}, 1fr)` }}>
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`rounded border px-2 py-1.5 text-xs transition-all ${
              value === opt.value
                ? "border-orange-500 bg-orange-500/30 text-white"
                : "border-neutral-600 text-neutral-400 hover:border-neutral-400"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Control Panel
// ============================================================================

interface ControlPanelProps {
  // Grid & Scene
  gridPreset: GridPreset;
  onGridPresetChange: (preset: GridPreset) => void;
  scenePreset: "grassField" | "forest" | "mixedTerrain";
  onScenePresetChange: (preset: "grassField" | "forest" | "mixedTerrain") => void;

  // Wind
  wind: WindParams;
  onWindChange: (wind: Partial<WindParams>) => void;

  // Simulation
  simulation: SimulationParams;
  onSimulationChange: (sim: Partial<SimulationParams>) => void;
  // Global multipliers
  globalBurnRate: number;
  onGlobalBurnRateChange: (val: number) => void;
  globalFuel: number;
  onGlobalFuelChange: (val: number) => void;

  // Tools
  tool: InteractionTool;
  onToolChange: (tool: InteractionTool) => void;
  brushRadius: number;
  onBrushRadiusChange: (radius: number) => void;
  paintMaterial: MaterialType;
  onPaintMaterialChange: (mat: MaterialType) => void;

  // Control
  paused: boolean;
  onPausedChange: (paused: boolean) => void;
  onReset: () => void;

  // Stats
  stats: {
    burning: number;
    steaming: number;
    charred: number;
    avgTemp: number;
    avgMoist: number;
    stepMs: number;
  };

  // Display
  showGlow: boolean;
  onShowGlowChange: (show: boolean) => void;
  showDebugGrid: boolean;
  onShowDebugGridChange: (show: boolean) => void;
}

function ControlPanel({
  gridPreset,
  onGridPresetChange,
  scenePreset,
  onScenePresetChange,
  wind,
  onWindChange,
  simulation,
  onSimulationChange,
  globalBurnRate,
  onGlobalBurnRateChange,
  globalFuel,
  onGlobalFuelChange,
  tool,
  onToolChange,
  brushRadius,
  onBrushRadiusChange,
  paintMaterial,
  onPaintMaterialChange,
  paused,
  onPausedChange,
  onReset,
  stats,
  showGlow,
  onShowGlowChange,
  showDebugGrid,
  onShowDebugGridChange,
}: ControlPanelProps) {
  return (
    <div className="pointer-events-auto absolute bottom-6 right-6 z-10 w-80 max-h-[85vh] overflow-y-auto rounded-xl border border-white/10 bg-black/80 p-5 text-white shadow-2xl backdrop-blur-md">
      {/* Playback Controls */}
      <section className="mb-4">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onPausedChange(!paused)}
            className={`flex-1 rounded-lg px-4 py-2 font-semibold transition-all ${
              paused
                ? "bg-green-600 hover:bg-green-500"
                : "bg-yellow-600 hover:bg-yellow-500"
            }`}
          >
            {paused ? "▶ Play" : "⏸ Pause"}
          </button>
          <button
            type="button"
            onClick={onReset}
            className="flex-1 rounded-lg bg-neutral-700 px-4 py-2 font-semibold hover:bg-neutral-600 transition-all"
          >
            ↺ Reset
          </button>
        </div>
      </section>

      {/* Stats */}
      <section className="mb-4 rounded-lg bg-neutral-800/50 p-3">
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div>
            <div className="text-orange-400 font-bold text-lg">{stats.burning}</div>
            <div className="text-neutral-500">Burning</div>
          </div>
          <div>
            <div className="text-blue-400 font-bold text-lg">{stats.steaming}</div>
            <div className="text-neutral-500">Steaming</div>
          </div>
          <div>
            <div className="text-neutral-400 font-bold text-lg">{stats.charred}</div>
            <div className="text-neutral-500">Charred</div>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
          <div>
            <div className="text-red-400">{(stats.avgTemp * 100).toFixed(0)}%</div>
            <div className="text-neutral-500">Avg Temp</div>
          </div>
          <div>
            <div className="text-cyan-400">{(stats.avgMoist * 100).toFixed(0)}%</div>
            <div className="text-neutral-500">Avg Moist</div>
          </div>
          <div>
            <div className="text-neutral-400">{stats.stepMs.toFixed(1)}ms</div>
            <div className="text-neutral-500">Step Time</div>
          </div>
        </div>
      </section>

      {/* Scene Settings */}
      <section className="mb-4">
        <h2 className="mb-3 border-b border-white/10 pb-2 text-sm font-bold uppercase tracking-widest text-neutral-400">
          Scene
        </h2>
        <ButtonGroup
          label="Grid Size"
          options={[
            { value: "small" as GridPreset, label: "64³" },
            { value: "medium" as GridPreset, label: "128³" },
            { value: "large" as GridPreset, label: "256³" },
          ]}
          value={gridPreset}
          onChange={onGridPresetChange}
        />
        <ButtonGroup
          label="Terrain"
          options={[
            { value: "grassField" as const, label: "Grass" },
            { value: "forest" as const, label: "Forest" },
            { value: "mixedTerrain" as const, label: "Mixed" },
          ]}
          value={scenePreset}
          onChange={onScenePresetChange}
        />
      </section>

      {/* Interaction Tools */}
      <section className="mb-4">
        <h2 className="mb-3 border-b border-white/10 pb-2 text-sm font-bold uppercase tracking-widest text-neutral-400">
          Tools
        </h2>
        <ButtonGroup
          label="Click Action"
          options={[
            { value: InteractionTool.IGNITE, label: "🔥 Ignite" },
            { value: InteractionTool.EXTINGUISH, label: "💧 Wet" },
            { value: InteractionTool.HEAT, label: "🌡️ Heat" },
            { value: InteractionTool.COOL, label: "❄️ Cool" },
          ]}
          value={tool}
          onChange={onToolChange}
        />
        <Slider
          id="brushRadius"
          label="Brush Radius"
          value={brushRadius}
          min={1}
          max={10}
          step={1}
          formatter={(v) => `${v} voxels`}
          onChange={onBrushRadiusChange}
        />
      </section>

      {/* Wind Controls */}
      <section className="mb-4">
        <h2 className="mb-3 border-b border-white/10 pb-2 text-sm font-bold uppercase tracking-widest text-neutral-400">
          Wind
        </h2>
        <Slider
          id="windDirection"
          label="Base Direction"
          value={wind.direction}
          min={0}
          max={360}
          step={5}
          formatter={(v) => `${v}°`}
          onChange={(v) => onWindChange({ direction: v })}
        />
        <Slider
          id="windSpeed"
          label="Base Speed"
          value={wind.speed}
          min={0}
          max={1}
          step={0.05}
          formatter={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => onWindChange({ speed: v })}
        />
        <Slider
          id="turbulence"
          label="Turbulence"
          value={wind.turbulence}
          min={0}
          max={1}
          step={0.05}
          formatter={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => onWindChange({ turbulence: v })}
        />
        <Slider
          id="localVariation"
          label="Local Variation"
          value={wind.localVariation}
          min={0}
          max={1}
          step={0.05}
          formatter={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => onWindChange({ localVariation: v })}
        />
        <Slider
          id="variationScale"
          label="Variation Scale"
          value={wind.variationScale}
          min={0.01}
          max={0.2}
          step={0.01}
          formatter={(v) => v.toFixed(2)}
          onChange={(v) => onWindChange({ variationScale: v })}
        />
      </section>

      {/* Simulation Parameters */}
      <section className="mb-4">
        <h2 className="mb-3 border-b border-white/10 pb-2 text-sm font-bold uppercase tracking-widest text-neutral-400">
          Simulation
        </h2>
        <Slider
          id="timeScale"
          label="Time Scale"
          value={simulation.timeScale}
          min={0.1}
          max={10}
          step={0.1}
          formatter={(v) => `${v.toFixed(1)}x`}
          onChange={(v) => onSimulationChange({ timeScale: v })}
        />
        <Slider
          id="globalFuel"
          label="Fuel Density"
          value={globalFuel}
          min={0.1}
          max={3.0}
          step={0.1}
          formatter={(v) => `${Math.round(v * 100)}%`}
          onChange={onGlobalFuelChange}
        />
        <Slider
          id="globalBurnRate"
          label="Burn Rate"
          value={globalBurnRate}
          min={0.1}
          max={3.0}
          step={0.1}
          formatter={(v) => `${Math.round(v * 100)}%`}
          onChange={onGlobalBurnRateChange}
        />
        <Slider
          id="ambientTemp"
          label="Ambient Temperature"
          value={simulation.ambientTemperature}
          min={0}
          max={0.5}
          step={0.01}
          formatter={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => onSimulationChange({ ambientTemperature: v })}
        />
        <Slider
          id="ambientHumidity"
          label="Humidity"
          value={simulation.ambientHumidity}
          min={0}
          max={1}
          step={0.05}
          formatter={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => onSimulationChange({ ambientHumidity: v })}
        />
        <Slider
          id="convection"
          label="Convection Strength"
          value={simulation.convectionStrength}
          min={1}
          max={10}
          step={0.5}
          formatter={(v) => `${v.toFixed(1)}x`}
          onChange={(v) => onSimulationChange({ convectionStrength: v })}
        />
      </section>

      {/* Display Options */}
      <section>
        <h2 className="mb-3 border-b border-white/10 pb-2 text-sm font-bold uppercase tracking-widest text-neutral-400">
          Display
        </h2>
        <label className="flex items-center gap-2 cursor-pointer mb-2">
          <input
            type="checkbox"
            checked={showGlow}
            onChange={(e) => onShowGlowChange(e.target.checked)}
            className="h-4 w-4 rounded border-neutral-600 bg-neutral-800 accent-orange-500"
          />
          <span className="text-sm">Fire Glow Effect</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showDebugGrid}
            onChange={(e) => onShowDebugGridChange(e.target.checked)}
            className="h-4 w-4 rounded border-neutral-600 bg-neutral-800 accent-green-500"
          />
          <span className="text-sm">Debug Grid Bounds</span>
        </label>
      </section>
    </div>
  );
}

// ============================================================================
// Main Page
// ============================================================================

export default function FirePropagationPage() {
  // State
  const [gridPreset, setGridPreset] = useState<GridPreset>("small");
  const [scenePreset, setScenePreset] = useState<"grassField" | "forest" | "mixedTerrain">("mixedTerrain");
  const [wind, setWind] = useState<WindParams>({ ...DEFAULT_WIND });
  const [simulation, setSimulation] = useState<SimulationParams>({ ...DEFAULT_SIMULATION });
  const [globalBurnRate, setGlobalBurnRate] = useState(1.0);
  const [globalFuel, setGlobalFuel] = useState(1.0);
  const [tool, setTool] = useState<InteractionTool>(InteractionTool.IGNITE);
  const [brushRadius, setBrushRadius] = useState(3);
  const [paintMaterial, setPaintMaterial] = useState<MaterialType>(MaterialType.GRASS);
  const [paused, setPaused] = useState(false);
  const [resetTrigger, setResetTrigger] = useState(0);
  const [showGlow, setShowGlow] = useState(true);
  const [showDebugGrid, setShowDebugGrid] = useState(false);
  const [stats, setStats] = useState({
    burning: 0,
    steaming: 0,
    charred: 0,
    avgTemp: 0,
    avgMoist: 0,
    stepMs: 0,
  });

  const handleWindChange = useCallback((changes: Partial<WindParams>) => {
    setWind((prev) => ({ ...prev, ...changes }));
  }, []);

  const handleSimulationChange = useCallback((changes: Partial<SimulationParams>) => {
    setSimulation((prev) => ({ ...prev, ...changes }));
  }, []);

  const handleReset = useCallback(() => {
    setResetTrigger((t) => t + 1);
  }, []);

  const handleStatsUpdate = useCallback((newStats: typeof stats) => {
    setStats(newStats);
  }, []);

  return (
    <div className="relative min-h-screen w-full select-none bg-neutral-900 font-sans text-white">
      {/* 3D Canvas */}
      <div className="absolute inset-0">
        <Canvas
          camera={{
            position: [80, 60, 80],
            fov: 50,
            near: 0.1,
            far: 2000,
          }}
          gl={{
            antialias: true,
          }}
        >
          <color attach="background" args={["#1a1a2e"]} />
          <fog attach="fog" args={["#1a1a2e", 200, 800]} />
          <Suspense fallback={null}>
            <FireScene
              gridPreset={gridPreset}
              scenePreset={scenePreset}
              wind={wind}
              simulation={simulation}
              globalBurnRate={globalBurnRate}
              globalFuel={globalFuel}
              tool={tool}
              brushRadius={brushRadius}
              paintMaterial={paintMaterial}
              paused={paused}
              resetTrigger={resetTrigger}
              onStatsUpdate={handleStatsUpdate}
              showGlow={showGlow}
              showDebugGrid={showDebugGrid}
              showStats={true}
            />
          </Suspense>
        </Canvas>
      </div>

      {/* UI Overlay */}
      <div className="relative z-10 min-h-screen pointer-events-none">
        {/* Header */}
        <div className="absolute left-0 top-0 flex w-full items-start justify-between p-6 text-left">
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-neutral-200 drop-shadow-md">
              Fire Propagation
            </h1>
            <p className="mt-2 max-w-lg rounded-lg border border-white/10 bg-black/60 p-4 text-sm text-neutral-400 shadow-xl backdrop-blur-md">
              <strong>Inspired by:</strong> Far Cry 2&apos;s dynamic fire system
              <br />
              <strong>Features:</strong> Temperature + moisture dual-axis state, wind propagation, material types
              <br />
              <strong>Controls:</strong> Click to ignite/wet. Orbit with mouse. Adjust parameters in panel.
            </p>
          </div>
        </div>

        {/* Control Panel */}
        <ControlPanel
          gridPreset={gridPreset}
          onGridPresetChange={setGridPreset}
          scenePreset={scenePreset}
          onScenePresetChange={setScenePreset}
          wind={wind}
          onWindChange={handleWindChange}
          simulation={simulation}
          onSimulationChange={handleSimulationChange}
          globalBurnRate={globalBurnRate}
          onGlobalBurnRateChange={setGlobalBurnRate}
          globalFuel={globalFuel}
          onGlobalFuelChange={setGlobalFuel}
          tool={tool}
          onToolChange={setTool}
          brushRadius={brushRadius}
          onBrushRadiusChange={setBrushRadius}
          paintMaterial={paintMaterial}
          onPaintMaterialChange={setPaintMaterial}
          paused={paused}
          onPausedChange={setPaused}
          onReset={handleReset}
          stats={stats}
          showGlow={showGlow}
          onShowGlowChange={setShowGlow}
          showDebugGrid={showDebugGrid}
          onShowDebugGridChange={setShowDebugGrid}
        />

        {/* Footer */}
        <div className="pointer-events-none absolute bottom-6 left-6">
          <p className="font-mono text-xs uppercase tracking-widest text-neutral-500">
            Three.js / React Three Fiber / CPU Simulation
          </p>
        </div>
      </div>
    </div>
  );
}

