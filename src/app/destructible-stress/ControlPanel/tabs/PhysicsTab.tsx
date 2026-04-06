"use client";

import { memo } from "react";
import type { OptimizationMode, DebrisCollisionMode } from "@/lib/stress/core/types";
import type { PhysicsTabProps } from "../types";
import {
  NumberInput,
  Section,
  Select,
  Separator,
  Slider,
  TabContent,
  Toggle,
} from "../components";

const OPTIMIZATION_MODE_OPTIONS = [
  { value: "off" as const, label: "Off" },
  { value: "always" as const, label: "Always" },
  { value: "afterGroundCollision" as const, label: "After ground collision" },
];

const DEBRIS_COLLISION_MODE_OPTIONS = [
  { value: "all" as const, label: "All collisions allowed" },
  { value: "noDebrisPairs" as const, label: "Block debris ↔ debris" },
  { value: "debrisGroundOnly" as const, label: "Debris vs ground only" },
  { value: "debrisNone" as const, label: "Debris has no collisions" },
];

const SNAPSHOT_MODE_OPTIONS = [
  { value: "perBody" as const, label: "Per-body (recommended)" },
  { value: "world" as const, label: "World snapshot" },
];

export const PhysicsTab = memo(function PhysicsTab(props: PhysicsTabProps) {
  const {
    gravity,
    setGravity,
    solverGravityEnabled,
    setSolverGravityEnabled,
    adaptiveDt,
    setAdaptiveDt,
    sleepMode,
    setSleepMode,
    sleepLinearThreshold,
    setSleepLinearThreshold,
    sleepAngularThreshold,
    setSleepAngularThreshold,
    smallBodyDampingMode,
    setSmallBodyDampingMode,
    smallBodyColliderThreshold,
    setSmallBodyColliderThreshold,
    smallBodyMinLinearDamping,
    setSmallBodyMinLinearDamping,
    smallBodyMinAngularDamping,
    setSmallBodyMinAngularDamping,
    resimulateOnFracture,
    setResimulateOnFracture,
    resimulateOnDamageDestroy,
    setResimulateOnDamageDestroy,
    maxResimulationPasses,
    setMaxResimulationPasses,
    snapshotMode,
    setSnapshotMode,
    debrisCollisionMode,
    setDebrisCollisionMode,
    skipDebrisBodies,
    setSkipDebrisBodies,
    maxCollidersForDebris,
    setMaxCollidersForDebris,
    debrisTtlMs,
    setDebrisTtlMs,
    debrisCleanupMode,
    setDebrisCleanupMode,
    damageEnabled,
  } = props;

  return (
    <TabContent>
      {/* Gravity Controls */}
      <Slider
        label="Gravity"
        value={gravity}
        onChange={setGravity}
        min={-30}
        max={0}
        step={0.5}
        formatValue={(v) => v.toFixed(2)}
      />
      <Toggle
        label="Apply gravity to solver"
        checked={solverGravityEnabled}
        onChange={setSolverGravityEnabled}
      />
      <Toggle
        label="Adaptive dt (render delta)"
        checked={adaptiveDt}
        onChange={setAdaptiveDt}
      />

      <Separator />

      {/* Sleep Optimization */}
      <Section title="Sleep Optimization" defaultOpen>
        <Select<OptimizationMode>
          label="Mode"
          value={sleepMode}
          onChange={setSleepMode}
          options={OPTIMIZATION_MODE_OPTIONS}
        />
        <NumberInput
          label="Linear threshold (m/s)"
          value={sleepLinearThreshold}
          onChange={setSleepLinearThreshold}
          min={0}
          step={0.01}
          disabled={sleepMode === "off"}
          formatValue={(v) => `${v.toFixed(2)} m/s`}
        />
        <NumberInput
          label="Angular threshold (rad/s)"
          value={sleepAngularThreshold}
          onChange={setSleepAngularThreshold}
          min={0}
          step={0.01}
          disabled={sleepMode === "off"}
          formatValue={(v) => `${v.toFixed(2)} rad/s`}
        />
      </Section>

      {/* Small Body Damping */}
      <Section
        title="Small Body Damping"
        defaultOpen
        description="Apply higher damping to fractured bodies with few colliders to reduce jitter."
      >
        <Select<OptimizationMode>
          label="Mode"
          value={smallBodyDampingMode}
          onChange={setSmallBodyDampingMode}
          options={OPTIMIZATION_MODE_OPTIONS}
        />
        <Slider
          label="Collider threshold"
          value={smallBodyColliderThreshold}
          onChange={(v) => setSmallBodyColliderThreshold(Math.round(v))}
          min={1}
          max={10}
          step={1}
          formatValue={(v) => `≤${Math.round(v)}`}
          disabled={smallBodyDampingMode === "off"}
        />
        <Slider
          label="Min linear damping"
          value={smallBodyMinLinearDamping}
          onChange={setSmallBodyMinLinearDamping}
          min={0}
          max={10}
          step={0.1}
          formatValue={(v) => v.toFixed(1)}
          disabled={smallBodyDampingMode === "off"}
        />
        <Slider
          label="Min angular damping"
          value={smallBodyMinAngularDamping}
          onChange={setSmallBodyMinAngularDamping}
          min={0}
          max={10}
          step={0.1}
          formatValue={(v) => v.toFixed(1)}
          disabled={smallBodyDampingMode === "off"}
        />
      </Section>

      {/* Fracture Rollback */}
      <Section title="Fracture Rollback" defaultOpen>
        <Toggle
          label="Resimulate on fracture (same-frame)"
          checked={resimulateOnFracture}
          onChange={setResimulateOnFracture}
        />
        <Toggle
          label="Resimulate on damage destroy"
          checked={resimulateOnDamageDestroy}
          onChange={setResimulateOnDamageDestroy}
          disabled={!damageEnabled}
        />
        <Slider
          label="Max resim passes"
          value={maxResimulationPasses}
          onChange={(v) => setMaxResimulationPasses(Math.round(v))}
          min={0}
          max={2}
          step={1}
          formatValue={(v) => Math.round(v).toString()}
        />
        <Select<"perBody" | "world">
          label="Snapshot mode"
          value={snapshotMode}
          onChange={setSnapshotMode}
          options={SNAPSHOT_MODE_OPTIONS}
        />
      </Section>

      {/* Debris Settings */}
      <Section
        title="Debris Settings"
        defaultOpen
        description="Configure how small fragment bodies (debris) are handled."
      >
        <Slider
          label="Max colliders for debris"
          value={maxCollidersForDebris}
          onChange={(v) => setMaxCollidersForDebris(Math.round(v))}
          min={1}
          max={10}
          step={1}
          formatValue={(v) => `≤${Math.round(v)}`}
        />
        <Select<DebrisCollisionMode>
          label="Debris collision mode"
          value={debrisCollisionMode}
          onChange={setDebrisCollisionMode}
          options={DEBRIS_COLLISION_MODE_OPTIONS}
        />
        <Toggle
          label="Skip debris bodies on fracture"
          checked={skipDebrisBodies}
          onChange={setSkipDebrisBodies}
        />
        <Separator />
        <Select<OptimizationMode>
          label="Debris cleanup mode"
          value={debrisCleanupMode}
          onChange={setDebrisCleanupMode}
          options={OPTIMIZATION_MODE_OPTIONS}
        />
        <Slider
          label="Debris TTL"
          value={debrisTtlMs}
          onChange={setDebrisTtlMs}
          min={0}
          max={60000}
          step={1000}
          formatValue={(v) => v === 0 ? "Disabled" : `${(v / 1000).toFixed(0)}s`}
          disabled={debrisCleanupMode === "off"}
        />
      </Section>
    </TabContent>
  );
});
