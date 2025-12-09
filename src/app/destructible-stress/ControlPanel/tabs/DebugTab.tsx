"use client";

import { memo } from "react";
import type { DebugTabProps, ProfilerStatsState } from "../types";
import {
  Button,
  Section,
  Separator,
  TabContent,
  Toggle,
} from "../components";

// ============================================================================
// Profiler Controls Sub-component
// ============================================================================

type ProfilerControlsInternalProps = {
  profilingEnabled: boolean;
  startProfiling: () => void;
  stopProfiling: () => void;
  profilerStats: ProfilerStatsState;
};

const ProfilerControls = memo(function ProfilerControls({
  profilingEnabled,
  startProfiling,
  stopProfiling,
  profilerStats,
}: ProfilerControlsInternalProps) {
  const lastSample = profilerStats.lastSample;

  const formatMs = (value?: number | null) =>
    typeof value === "number" ? `${value.toFixed(2)} ms` : "-";

  const renderMetricRow = (label: string, value?: number) => (
    <div
      key={label}
      className="flex justify-between text-xs text-gray-300 tabular-nums"
    >
      <span>{label}</span>
      <span>{formatMs(value)}</span>
    </div>
  );

  const fractureRows = lastSample
    ? [
        { label: "Fracture total", value: lastSample.fractureMs },
        { label: "Generate", value: lastSample.fractureGenerateMs },
        { label: "Apply", value: lastSample.fractureApplyMs },
        { label: "Split queue", value: lastSample.splitQueueMs },
        { label: "Body create", value: lastSample.bodyCreateMs },
        { label: "Collider rebuild", value: lastSample.colliderRebuildMs },
        { label: "Cleanup", value: lastSample.cleanupDisabledMs },
      ]
    : [];

  const damageRows = lastSample
    ? [
        { label: "Damage replay", value: lastSample.damageReplayMs },
        { label: "Damage preview", value: lastSample.damagePreviewMs },
        { label: "Damage tick", value: lastSample.damageTickMs },
        { label: "Snapshot capture", value: lastSample.damageSnapshotMs },
        { label: "Snapshot restore", value: lastSample.damageRestoreMs },
        { label: "Pre-destroy", value: lastSample.damagePreDestroyMs },
        { label: "Flush fractures", value: lastSample.damageFlushMs },
      ]
    : [];

  const maintenanceRows = lastSample
    ? [
        { label: "Spawn queue", value: lastSample.spawnMs },
        { label: "External forces", value: lastSample.externalForceMs },
        { label: "Pre-step sweep", value: lastSample.preStepSweepMs },
        { label: "Collider rebuild map", value: lastSample.rebuildColliderMapMs },
        { label: "Projectile cleanup", value: lastSample.projectileCleanupMs },
      ]
    : [];

  return (
    <Section title="Profiler" defaultOpen>
      <div className="flex gap-2">
        {!profilingEnabled ? (
          <Button onClick={startProfiling}>Start profiler</Button>
        ) : (
          <Button onClick={stopProfiling} variant="danger">
            Stop & Download
          </Button>
        )}
      </div>

      {profilingEnabled && (
        <div className="text-xs text-gray-400">
          Status: Recording · Samples: {profilerStats.sampleCount}
          {typeof profilerStats.lastFrameMs === "number" &&
            ` · Last frame ${profilerStats.lastFrameMs.toFixed(2)} ms`}
        </div>
      )}

      {profilingEnabled && lastSample && (
        <div className="flex flex-col gap-2">
          {fractureRows.length > 0 && (
            <div>
              <div className="text-xs text-gray-400 mb-0.5">
                Fracture breakdown
              </div>
              <div className="flex flex-col gap-0.5 bg-gray-900 px-1.5 py-1 rounded border border-gray-800">
                {fractureRows.map((row) => renderMetricRow(row.label, row.value))}
              </div>
            </div>
          )}
          {damageRows.length > 0 && (
            <div>
              <div className="text-xs text-gray-400 mb-0.5">
                Damage breakdown
              </div>
              <div className="flex flex-col gap-0.5 bg-gray-900 px-1.5 py-1 rounded border border-gray-800">
                {damageRows.map((row) => renderMetricRow(row.label, row.value))}
              </div>
            </div>
          )}
          {maintenanceRows.length > 0 && (
            <div>
              <div className="text-xs text-gray-400 mb-0.5">
                Maintenance
              </div>
              <div className="flex flex-col gap-0.5 bg-gray-900 px-1.5 py-1 rounded border border-gray-800">
                {maintenanceRows.map((row) => renderMetricRow(row.label, row.value))}
              </div>
            </div>
          )}
        </div>
      )}
    </Section>
  );
});

// ============================================================================
// Debug Tab
// ============================================================================

export const DebugTab = memo(function DebugTab(props: DebugTabProps) {
  const {
    debug,
    setDebug,
    physicsWireframe,
    setPhysicsWireframe,
    autoBondingEnabled,
    setAutoBondingEnabled,
    showPerfOverlay,
    setShowPerfOverlay,
    profilingEnabled,
    startProfiling,
    stopProfiling,
    profilerStats,
  } = props;

  return (
    <TabContent>
      {/* Profiler */}
      <ProfilerControls
        profilingEnabled={profilingEnabled}
        startProfiling={startProfiling}
        stopProfiling={stopProfiling}
        profilerStats={profilerStats}
      />

      <Separator />

      {/* Visualization */}
      <Section title="Visualization" defaultOpen>
        <Toggle
          label="Show perf overlay"
          checked={showPerfOverlay}
          onChange={setShowPerfOverlay}
        />
        <Toggle
          label="Show stress solver debug lines"
          checked={debug}
          onChange={setDebug}
        />
        <Toggle
          label="Physics wireframe"
          checked={physicsWireframe}
          onChange={setPhysicsWireframe}
        />
        <Toggle
          label="Auto bonds (experimental)"
          checked={autoBondingEnabled}
          onChange={setAutoBondingEnabled}
        />
      </Section>
    </TabContent>
  );
});
