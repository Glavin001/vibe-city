"use client";

import { memo } from "react";
import type { InteractionTabProps } from "../types";
import { Section, Select, Separator, Slider, TabContent } from "../components";

const MODE_OPTIONS = [
  { value: "projectile" as const, label: "Projectile" },
  { value: "cutter" as const, label: "Cutter" },
  { value: "push" as const, label: "Push" },
  { value: "damage" as const, label: "Damage" },
];

const PROJECTILE_TYPE_OPTIONS = [
  { value: "ball" as const, label: "Ball" },
  { value: "box" as const, label: "Box" },
];

const VIEW_MODE_OPTIONS = [
  { value: "orbit" as const, label: "Orbit" },
  { value: "fps" as const, label: "First Person" },
];

const MODE_DESCRIPTIONS: Record<string, string> = {
  projectile: "Click to fire projectiles at the structure.",
  cutter: "Click on chunks to cut their bonds.",
  push: "Click to apply force to chunks.",
  damage: "Click to apply damage to chunks. See Damage tab for detailed settings.",
};

export const InteractionTab = memo(function InteractionTab(
  props: InteractionTabProps,
) {
  const {
    mode,
    setMode,
    viewMode,
    setViewMode,
    projType,
    setProjType,
    projectileRadius,
    setProjectileRadius,
    projectileSpeed,
    setProjectileSpeed,
    projectileMass,
    setProjectileMass,
    pushForce,
    setPushForce,
  } = props;

  return (
    <TabContent>
      {/* View Mode Selection */}
      <Select<"orbit" | "fps">
        label="View Mode"
        value={viewMode}
        onChange={setViewMode}
        options={VIEW_MODE_OPTIONS}
      />
      <p className="mt-1 mb-0 text-gray-400 text-[13px] leading-snug">
        {viewMode === "fps"
          ? "WASD move, Space jump, Shift run. Click canvas to lock."
          : "Click and drag to orbit camera."}
      </p>

      <Separator />

      {/* Interaction Mode Selection */}
      <Select
        label="Action Mode"
        value={mode}
        onChange={setMode}
        options={MODE_OPTIONS}
      />
      <p className="mt-1 mb-0 text-gray-400 text-[13px] leading-snug">
        {MODE_DESCRIPTIONS[mode]}
      </p>

      <Separator />

      {/* Projectile Settings */}
      <Section
        title="Projectile"
        defaultOpen
        description={
          mode !== "projectile"
            ? "Used in Projectile mode."
            : undefined
        }
      >
        <Select<"ball" | "box">
          label="Type"
          value={projType}
          onChange={setProjType}
          options={PROJECTILE_TYPE_OPTIONS}
        />
        <Slider
          label="Size (radius, m)"
          value={projectileRadius}
          onChange={setProjectileRadius}
          min={0.1}
          max={3.0}
          step={0.05}
          formatValue={(v) => `${v.toFixed(2)}m`}
        />
        <Slider
          label="Speed"
          value={projectileSpeed}
          onChange={setProjectileSpeed}
          min={1}
          max={100}
          step={1}
          formatValue={(v) => v.toFixed(0)}
        />
        <Slider
          label="Mass"
          value={projectileMass}
          onChange={setProjectileMass}
          min={1}
          max={200000}
          step={1000}
          formatValue={(v) => v.toLocaleString()}
          valueWidth={80}
        />
      </Section>

      {/* Push Force */}
      <Section
        title="Push Force"
        defaultOpen
        description={
          mode !== "push"
            ? "Used in Push mode."
            : undefined
        }
      >
        <Slider
          label="Force (N)"
          value={pushForce}
          onChange={setPushForce}
          min={100}
          max={100_000_000}
          step={100}
          formatValue={(v) => Math.round(v).toLocaleString()}
          valueWidth={100}
        />
      </Section>
    </TabContent>
  );
});
