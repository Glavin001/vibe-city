"use client";

import { memo, useState } from "react";
import type { ControlPanelProps, TabId } from "./types";
import { PanelContainer, TabBar } from "./components";
import { SceneTab } from "./tabs/SceneTab";
import { InteractionTab } from "./tabs/InteractionTab";
import { PhysicsTab } from "./tabs/PhysicsTab";
import { DamageTab } from "./tabs/DamageTab";
import { DebugTab } from "./tabs/DebugTab";

// Re-export types and constants for convenience
export type {
  ControlPanelProps,
  ProfilerStatsState,
  StructurePreset,
  InteractionMode,
  ProjectileType,
  SnapshotMode,
} from "./types";

export { EMPTY_PROFILER_STATS } from "./types";

export const ControlPanel = memo(function ControlPanel(
  props: ControlPanelProps,
) {
  const {
    collapsed,
    setCollapsed,
    showPerfOverlay,
    setShowPerfOverlay,
    // Scene props
    structureId,
    setStructureId,
    structures,
    structureDescription,
    mode,
    setMode,
    reset,
    bodyCountRef,
    activeBodyCountRef,
    colliderCountRef,
    bondsCountRef,
    wallSpan,
    setWallSpan,
    wallHeight,
    setWallHeight,
    wallThickness,
    setWallThickness,
    wallSpanSeg,
    setWallSpanSeg,
    wallHeightSeg,
    setWallHeightSeg,
    wallLayers,
    setWallLayers,
    // Physics props
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
    // Projectile props
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
    // Damage props
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
    // Debug props
    debug,
    setDebug,
    physicsWireframe,
    setPhysicsWireframe,
    autoBondingEnabled,
    setAutoBondingEnabled,
    materialScale,
    setMaterialScale,
    bondsXEnabled,
    setBondsXEnabled,
    bondsYEnabled,
    setBondsYEnabled,
    bondsZEnabled,
    setBondsZEnabled,
    // Profiler props
    profilingEnabled,
    startProfiling,
    stopProfiling,
    profilerStats,
  } = props;

  const [activeTab, setActiveTab] = useState<TabId>("scene");

  // When perf overlay is hidden, we can position the panel higher
  const panelTop = showPerfOverlay ? 110 : 16;

  return (
    <PanelContainer
      collapsed={collapsed}
      onToggleCollapse={() => setCollapsed(!collapsed)}
      onReset={reset}
      panelTop={panelTop}
      bodyCountRef={bodyCountRef}
      activeBodyCountRef={activeBodyCountRef}
      colliderCountRef={colliderCountRef}
      bondsCountRef={bondsCountRef}
    >
      <TabBar activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === "scene" && (
        <SceneTab
          structureId={structureId}
          setStructureId={setStructureId}
          structures={structures}
          structureDescription={structureDescription}
          wallSpan={wallSpan}
          setWallSpan={setWallSpan}
          wallHeight={wallHeight}
          setWallHeight={setWallHeight}
          wallThickness={wallThickness}
          setWallThickness={setWallThickness}
          wallSpanSeg={wallSpanSeg}
          setWallSpanSeg={setWallSpanSeg}
          wallHeightSeg={wallHeightSeg}
          setWallHeightSeg={setWallHeightSeg}
          wallLayers={wallLayers}
          setWallLayers={setWallLayers}
          materialScale={materialScale}
          setMaterialScale={setMaterialScale}
          bondsXEnabled={bondsXEnabled}
          setBondsXEnabled={setBondsXEnabled}
          bondsYEnabled={bondsYEnabled}
          setBondsYEnabled={setBondsYEnabled}
          bondsZEnabled={bondsZEnabled}
          setBondsZEnabled={setBondsZEnabled}
        />
      )}

      {activeTab === "physics" && (
        <PhysicsTab
          gravity={gravity}
          setGravity={setGravity}
          solverGravityEnabled={solverGravityEnabled}
          setSolverGravityEnabled={setSolverGravityEnabled}
          adaptiveDt={adaptiveDt}
          setAdaptiveDt={setAdaptiveDt}
          sleepMode={sleepMode}
          setSleepMode={setSleepMode}
          sleepLinearThreshold={sleepLinearThreshold}
          setSleepLinearThreshold={setSleepLinearThreshold}
          sleepAngularThreshold={sleepAngularThreshold}
          setSleepAngularThreshold={setSleepAngularThreshold}
          smallBodyDampingMode={smallBodyDampingMode}
          setSmallBodyDampingMode={setSmallBodyDampingMode}
          smallBodyColliderThreshold={smallBodyColliderThreshold}
          setSmallBodyColliderThreshold={setSmallBodyColliderThreshold}
          smallBodyMinLinearDamping={smallBodyMinLinearDamping}
          setSmallBodyMinLinearDamping={setSmallBodyMinLinearDamping}
          smallBodyMinAngularDamping={smallBodyMinAngularDamping}
          setSmallBodyMinAngularDamping={setSmallBodyMinAngularDamping}
          resimulateOnFracture={resimulateOnFracture}
          setResimulateOnFracture={setResimulateOnFracture}
          resimulateOnDamageDestroy={resimulateOnDamageDestroy}
          setResimulateOnDamageDestroy={setResimulateOnDamageDestroy}
          maxResimulationPasses={maxResimulationPasses}
          setMaxResimulationPasses={setMaxResimulationPasses}
          snapshotMode={snapshotMode}
          setSnapshotMode={setSnapshotMode}
          singleCollisionMode={singleCollisionMode}
          setSingleCollisionMode={setSingleCollisionMode}
          skipSingleBodies={skipSingleBodies}
          setSkipSingleBodies={setSkipSingleBodies}
          damageEnabled={damageEnabled}
        />
      )}

      {activeTab === "interaction" && (
        <InteractionTab
          mode={mode}
          setMode={setMode}
          projType={projType}
          setProjType={setProjType}
          projectileRadius={projectileRadius}
          setProjectileRadius={setProjectileRadius}
          projectileSpeed={projectileSpeed}
          setProjectileSpeed={setProjectileSpeed}
          projectileMass={projectileMass}
          setProjectileMass={setProjectileMass}
          pushForce={pushForce}
          setPushForce={setPushForce}
        />
      )}

      {activeTab === "damage" && (
        <DamageTab
          damageEnabled={damageEnabled}
          setDamageEnabled={setDamageEnabled}
          damageClickRatio={damageClickRatio}
          setDamageClickRatio={setDamageClickRatio}
          contactDamageScale={contactDamageScale}
          setContactDamageScale={setContactDamageScale}
          internalContactScale={internalContactScale}
          setInternalContactScale={setInternalContactScale}
          minImpulseThreshold={minImpulseThreshold}
          setMinImpulseThreshold={setMinImpulseThreshold}
          contactCooldownMs={contactCooldownMs}
          setContactCooldownMs={setContactCooldownMs}
          speedMinExternal={speedMinExternal}
          setSpeedMinExternal={setSpeedMinExternal}
          speedMinInternal={speedMinInternal}
          setSpeedMinInternal={setSpeedMinInternal}
          speedMax={speedMax}
          setSpeedMax={setSpeedMax}
          speedExponent={speedExponent}
          setSpeedExponent={setSpeedExponent}
          slowSpeedFactor={slowSpeedFactor}
          setSlowSpeedFactor={setSlowSpeedFactor}
          fastSpeedFactor={fastSpeedFactor}
          setFastSpeedFactor={setFastSpeedFactor}
        />
      )}

      {activeTab === "debug" && (
        <DebugTab
          debug={debug}
          setDebug={setDebug}
          physicsWireframe={physicsWireframe}
          setPhysicsWireframe={setPhysicsWireframe}
          autoBondingEnabled={autoBondingEnabled}
          setAutoBondingEnabled={setAutoBondingEnabled}
          showPerfOverlay={showPerfOverlay}
          setShowPerfOverlay={setShowPerfOverlay}
          profilingEnabled={profilingEnabled}
          startProfiling={startProfiling}
          stopProfiling={stopProfiling}
          profilerStats={profilerStats}
        />
      )}
    </PanelContainer>
  );
});

export default ControlPanel;
