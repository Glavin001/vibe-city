"use client";

import { memo } from "react";
import type { OptimizationMode, SingleCollisionMode } from "@/lib/stress/core/types";
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

const COLLISION_MODE_OPTIONS = [
  { value: "all" as const, label: "All collisions allowed" },
  { value: "noSinglePairs" as const, label: "Block single ↔ single" },
  { value: "singleGround" as const, label: "Singles vs ground only" },
  { value: "singleNone" as const, label: "Singles have no collisions" },
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
    singleCollisionMode,
    setSingleCollisionMode,
    skipSingleBodies,
    setSkipSingleBodies,
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

      {/* Collision Settings */}
      <Section title="Collision Settings" defaultOpen>
        <Select<SingleCollisionMode>
          label="Single collision mode"
          value={singleCollisionMode}
          onChange={setSingleCollisionMode}
          options={COLLISION_MODE_OPTIONS}
        />
        <Toggle
          label="Destroy single fragment bodies"
          checked={skipSingleBodies}
          onChange={setSkipSingleBodies}
        />
      </Section>
    </TabContent>
  );
});
