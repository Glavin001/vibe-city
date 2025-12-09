"use client";

import { memo } from "react";
import type { SceneTabProps } from "../types";
import {
  Row,
  Section,
  Select,
  Slider,
  TabContent,
  Toggle,
} from "../components";

export const SceneTab = memo(function SceneTab(props: SceneTabProps) {
  const {
    structureId,
    setStructureId,
    structures,
    structureDescription,
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
    materialScale,
    setMaterialScale,
    bondsXEnabled,
    setBondsXEnabled,
    bondsYEnabled,
    setBondsYEnabled,
    bondsZEnabled,
    setBondsZEnabled,
  } = props;

  const isWallStructure =
    structureId === "wall" ||
    structureId === "fracturedWall" ||
    structureId === "brickWall";

  const structureOptions = structures.map((s) => ({
    value: s.id,
    label: s.label,
  }));

  return (
    <TabContent>
      {/* Structure Selection */}
      <Select
        label="Structure"
        value={structureId}
        onChange={setStructureId}
        options={structureOptions}
      />
      {structureDescription && (
        <p className="m-0 text-gray-400 text-[13px] leading-snug">
          {structureDescription}
        </p>
      )}

      {/* Material Strength */}
      <Section title="Material Strength" defaultOpen>
        <Slider
          label="Strength Scale"
          value={materialScale}
          onChange={setMaterialScale}
          min={1}
          max={50_000_000}
          step={10}
          formatValue={(v) => `${v.toFixed(0)}×`}
          valueWidth={100}
        />
      </Section>

      {/* Bond Axes */}
      <Section title="Bond Axes" defaultOpen>
        <Row gap={16}>
          <Toggle label="X" checked={bondsXEnabled} onChange={setBondsXEnabled} />
          <Toggle label="Y" checked={bondsYEnabled} onChange={setBondsYEnabled} />
          <Toggle label="Z" checked={bondsZEnabled} onChange={setBondsZEnabled} />
        </Row>
      </Section>

      {/* Wall Dimensions - at bottom since not always applicable */}
      <Section
        title="Wall Dimensions"
        defaultOpen
        disabled={!isWallStructure}
        description={
          !isWallStructure
            ? "Only available for wall preset structures."
            : undefined
        }
      >
        <Slider
          label="Span (m)"
          value={wallSpan}
          onChange={setWallSpan}
          min={2}
          max={20}
          step={0.5}
          formatValue={(v) => v.toFixed(1)}
          disabled={!isWallStructure}
        />
        <Slider
          label="Height (m)"
          value={wallHeight}
          onChange={setWallHeight}
          min={1}
          max={10}
          step={0.5}
          formatValue={(v) => v.toFixed(1)}
          disabled={!isWallStructure}
        />
        <Slider
          label="Thickness (m)"
          value={wallThickness}
          onChange={setWallThickness}
          min={0.1}
          max={1.0}
          step={0.02}
          formatValue={(v) => v.toFixed(2)}
          disabled={!isWallStructure}
        />
        <Slider
          label="Span Segments"
          value={wallSpanSeg}
          onChange={(v) => setWallSpanSeg(Math.round(v))}
          min={3}
          max={30}
          step={1}
          formatValue={(v) => Math.round(v).toString()}
          disabled={!isWallStructure}
        />
        <Slider
          label="Height Segments"
          value={wallHeightSeg}
          onChange={(v) => setWallHeightSeg(Math.round(v))}
          min={1}
          max={12}
          step={1}
          formatValue={(v) => Math.round(v).toString()}
          disabled={!isWallStructure}
        />
        <Slider
          label="Layers"
          value={wallLayers}
          onChange={(v) => setWallLayers(Math.round(v))}
          min={1}
          max={3}
          step={1}
          formatValue={(v) => Math.round(v).toString()}
          disabled={!isWallStructure}
        />
      </Section>

      {/* Help text */}
      <p className="m-0 text-gray-400 text-[13px]">
        Bottom row is support (infinite mass). Splits occur when bonds
        overstress.
      </p>
    </TabContent>
  );
});
