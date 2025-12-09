"use client";

import { memo } from "react";
import type { DamageTabProps } from "../types";
import { Section, Separator, Slider, TabContent, Toggle } from "../components";

export const DamageTab = memo(function DamageTab(props: DamageTabProps) {
  const {
    damageEnabled,
    setDamageEnabled,
    damageClickRatio,
    setDamageClickRatio,
    contactDamageScale,
    setContactDamageScale,
    internalContactScale,
    setInternalContactScale,
    minImpulseThreshold,
    setMinImpulseThreshold,
    contactCooldownMs,
    setContactCooldownMs,
    speedMinExternal,
    setSpeedMinExternal,
    speedMinInternal,
    setSpeedMinInternal,
    speedMax,
    setSpeedMax,
    speedExponent,
    setSpeedExponent,
    slowSpeedFactor,
    setSlowSpeedFactor,
    fastSpeedFactor,
    setFastSpeedFactor,
  } = props;

  return (
    <TabContent>
      {/* Main Toggle */}
      <Toggle
        label="Enable damageable chunks"
        checked={damageEnabled}
        onChange={setDamageEnabled}
      />

      <Separator />

      {/* Click Damage */}
      <Slider
        label="Per-click (% max health)"
        value={damageClickRatio}
        onChange={setDamageClickRatio}
        min={0.05}
        max={1}
        step={0.05}
        formatValue={(v) => `${Math.round(v * 100)}%`}
        disabled={!damageEnabled}
      />

      {/* Contact Damage */}
      <Section
        title="Contact Damage"
        defaultOpen
        disabled={!damageEnabled}
      >
        <Slider
          label="Contact scale"
          value={contactDamageScale}
          onChange={setContactDamageScale}
          min={0}
          max={10000}
          step={0.1}
          formatValue={(v) => `${v.toFixed(1)}×`}
        />
        <Slider
          label="Internal contact scale"
          value={internalContactScale}
          onChange={setInternalContactScale}
          min={0}
          max={1000}
          step={0.05}
          formatValue={(v) => `${v.toFixed(2)}×`}
        />
        <Slider
          label="Min impulse (N·s)"
          value={minImpulseThreshold}
          onChange={setMinImpulseThreshold}
          min={0}
          max={500}
          step={5}
          formatValue={(v) => Math.round(v).toString()}
        />
        <Slider
          label="Contact cooldown (ms)"
          value={contactCooldownMs}
          onChange={setContactCooldownMs}
          min={0}
          max={1000}
          step={10}
          formatValue={(v) => `${Math.round(v)}ms`}
        />
      </Section>

      {/* Impact Speed Scaling */}
      <Section
        title="Impact Speed Scaling"
        defaultOpen
        disabled={!damageEnabled}
      >
        <Slider
          label="Min speed external (m/s)"
          value={speedMinExternal}
          onChange={setSpeedMinExternal}
          min={0}
          max={5}
          step={0.05}
          formatValue={(v) => v.toFixed(2)}
        />
        <Slider
          label="Min speed internal (m/s)"
          value={speedMinInternal}
          onChange={setSpeedMinInternal}
          min={0}
          max={5}
          step={0.05}
          formatValue={(v) => v.toFixed(2)}
        />
        <Slider
          label="Full boost speed (m/s)"
          value={speedMax}
          onChange={setSpeedMax}
          min={1}
          max={20}
          step={0.5}
          formatValue={(v) => v.toFixed(1)}
        />
        <Slider
          label="Boost curve (exp)"
          value={speedExponent}
          onChange={setSpeedExponent}
          min={0.5}
          max={4}
          step={0.05}
          formatValue={(v) => v.toFixed(2)}
        />
        <Slider
          label="Slow factor"
          value={slowSpeedFactor}
          onChange={setSlowSpeedFactor}
          min={0.01}
          max={1.0}
          step={0.01}
          formatValue={(v) => `${v.toFixed(2)}×`}
        />
        <Slider
          label="Fast factor"
          value={fastSpeedFactor}
          onChange={setFastSpeedFactor}
          min={1.0}
          max={10.0}
          step={0.05}
          formatValue={(v) => `${v.toFixed(2)}×`}
        />
      </Section>
    </TabContent>
  );
});
