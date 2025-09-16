"use client";

import React, { useMemo, useState } from "react";

import { AssemblyCanvas } from "./AssemblyCanvas";
import {
  builderCatalog,
  editorExamples,
  getExampleBlueprint,
  type ExampleId,
} from "@/lib/builder/examples";
import type { Blueprint, PartInstance, Transform } from "@/lib/builder/model";
import {
  DEG2RAD,
  RAD2DEG,
  eulerToQuaternion,
  quaternionToEuler,
} from "@/lib/builder/math";
import {
  findJointByTag,
  partLabel,
  updatePartTransform,
} from "@/lib/builder/utils";

function formatNumber(value: number, fractionDigits = 2) {
  return Number.parseFloat(value.toFixed(fractionDigits));
}

function transformWithUpdate(
  part: PartInstance,
  updater: (transform: Transform) => Transform,
  blueprint: Blueprint,
  setBlueprint: (next: Blueprint) => void,
) {
  const updated = updater(part.transform);
  setBlueprint(updatePartTransform(blueprint, part.id, updated));
}

export function AssemblyEditor() {
  const [exampleId, setExampleId] = useState<ExampleId>("house");
  const [blueprint, setBlueprint] = useState<Blueprint>(() =>
    getExampleBlueprint("house"),
  );
  const [mode, setMode] = useState<"edit" | "simulate">("edit");
  const [transformMode, setTransformMode] =
    useState<"translate" | "rotate">("translate");
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [doorAngleDeg, setDoorAngleDeg] = useState<number>(0);
  const [jointTargets, setJointTargets] = useState<Record<string, number>>({});

  const catalog = builderCatalog;

  const selectedPart = useMemo(
    () => blueprint.root.parts.find((part) => part.id === selectedPartId),
    [blueprint, selectedPartId],
  );

  const selectedPartDef = useMemo(() => {
    if (!selectedPart) return undefined;
    return catalog.parts[selectedPart.partId];
  }, [catalog.parts, selectedPart]);

  const doorJoint = useMemo(() => findJointByTag(blueprint, "door"), [blueprint]);

  const handleSelectExample = (id: ExampleId) => {
    const next = getExampleBlueprint(id);
    setExampleId(id);
    setBlueprint(next);
    setMode("edit");
    setTransformMode("translate");
    setSelectedPartId(null);
    setDoorAngleDeg(0);
    const door = findJointByTag(next, "door");
    setJointTargets(door ? { [door.id]: 0 } : {});
  };

  const handleSelectPart = (id: string | null) => {
    setSelectedPartId((current) => (current === id ? null : id));
  };

  const handleTransformChange = (partId: string, transform: Transform) => {
    setBlueprint((current) => updatePartTransform(current, partId, transform));
  };

  const handlePositionChange = (axis: 0 | 1 | 2, value: number) => {
    if (!selectedPart) return;
    transformWithUpdate(
      selectedPart,
      (transform) => {
        const nextPosition: Transform["position"] = [...transform.position];
        nextPosition[axis] = value;
        return {
          position: nextPosition,
          rotationQuat: [...transform.rotationQuat],
        };
      },
      blueprint,
      setBlueprint,
    );
  };

  const handleRotationChange = (axis: 0 | 1 | 2, valueDeg: number) => {
    if (!selectedPart) return;
    transformWithUpdate(
      selectedPart,
      (transform) => {
        const euler = quaternionToEuler(transform.rotationQuat);
        const nextEuler: [number, number, number] = [...euler];
        nextEuler[axis] = valueDeg * DEG2RAD;
        return {
          position: [...transform.position],
          rotationQuat: eulerToQuaternion(nextEuler),
        };
      },
      blueprint,
      setBlueprint,
    );
  };

  const handleDoorAngleChange = (value: number) => {
    setDoorAngleDeg(value);
    if (!doorJoint) return;
    setJointTargets((previous) => ({
      ...previous,
      [doorJoint.id]: value * DEG2RAD,
    }));
  };

  const activeJointTargets = useMemo(() => {
    if (!doorJoint) return jointTargets;
    return {
      ...jointTargets,
      [doorJoint.id]: doorAngleDeg * DEG2RAD,
    };
  }, [doorJoint, jointTargets, doorAngleDeg]);

  const partItems = blueprint.root.parts.map((part) => {
    const def = catalog.parts[part.partId];
    return {
      part,
      def,
      label: partLabel(part, def?.name),
    };
  });

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <aside className="w-full lg:w-80 flex-shrink-0 space-y-6 rounded-xl bg-slate-900/80 p-6 text-slate-100 shadow-lg">
        <section>
          <h2 className="mb-3 text-lg font-semibold text-slate-50">Blueprint</h2>
          <div className="grid grid-cols-1 gap-2">
            {Object.values(editorExamples).map((example) => (
              <button
                key={example.id}
                onClick={() => handleSelectExample(example.id)}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${exampleId === example.id ? "border-blue-400 bg-blue-500/20" : "border-slate-700 hover:border-blue-400/60"}`}
              >
                <div className="text-sm font-medium text-slate-100">
                  {example.label}
                </div>
                <div className="text-xs text-slate-400">
                  {example.id === "house"
                    ? "Static structure with articulated door"
                    : "Four-wheel rover with drive motors"}
                </div>
              </button>
            ))}
            <button
              onClick={() => handleSelectExample(exampleId)}
              className="rounded-lg border border-slate-700 px-3 py-2 text-left text-sm text-slate-200 transition hover:border-blue-400/60"
            >
              Reset Current Blueprint
            </button>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-slate-50">Mode</h2>
          <div className="flex gap-2">
            <button
              onClick={() => setMode("edit")}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${mode === "edit" ? "bg-blue-500 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
            >
              Edit
            </button>
            <button
              onClick={() => setMode("simulate")}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${mode === "simulate" ? "bg-emerald-500 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
            >
              Simulate
            </button>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => setTransformMode("translate")}
              className={`flex-1 rounded-md px-2 py-1 text-xs font-medium transition ${transformMode === "translate" ? "bg-blue-400/30 text-blue-100" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
            >
              Move
            </button>
            <button
              onClick={() => setTransformMode("rotate")}
              className={`flex-1 rounded-md px-2 py-1 text-xs font-medium transition ${transformMode === "rotate" ? "bg-blue-400/30 text-blue-100" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
            >
              Rotate
            </button>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-slate-50">Parts</h2>
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {partItems.map(({ part, def, label }) => (
              <button
                key={part.id}
                onClick={() => handleSelectPart(part.id)}
                className={`w-full rounded-md border px-3 py-2 text-left text-sm transition ${selectedPartId === part.id ? "border-blue-400 bg-blue-500/20" : "border-slate-700 bg-slate-800 hover:border-blue-400/60"}`}
              >
                <div className="font-medium text-slate-100">{label}</div>
                <div className="text-xs text-slate-400">
                  {def?.category ?? "Unknown"} · {def?.physics?.dynamic ? "Dynamic" : "Static"}
                </div>
              </button>
            ))}
          </div>
        </section>

        {selectedPart && selectedPartDef && (
          <section className="space-y-3">
            <h3 className="text-lg font-semibold text-slate-50">Transform</h3>
            <div className="space-y-2 text-xs text-slate-200">
              <div className="grid grid-cols-4 items-center gap-2">
                <span className="col-span-1 text-slate-400">Pos X</span>
                <input
                  type="number"
                  className="col-span-3 rounded bg-slate-800 px-2 py-1"
                  step={0.1}
                  value={formatNumber(selectedPart.transform.position[0])}
                  onChange={(event) =>
                    handlePositionChange(0, Number.parseFloat(event.target.value))
                  }
                />
                <span className="text-slate-400">Pos Y</span>
                <input
                  type="number"
                  className="col-span-3 rounded bg-slate-800 px-2 py-1"
                  step={0.1}
                  value={formatNumber(selectedPart.transform.position[1])}
                  onChange={(event) =>
                    handlePositionChange(1, Number.parseFloat(event.target.value))
                  }
                />
                <span className="text-slate-400">Pos Z</span>
                <input
                  type="number"
                  className="col-span-3 rounded bg-slate-800 px-2 py-1"
                  step={0.1}
                  value={formatNumber(selectedPart.transform.position[2])}
                  onChange={(event) =>
                    handlePositionChange(2, Number.parseFloat(event.target.value))
                  }
                />
              </div>
              {(() => {
                const euler = quaternionToEuler(selectedPart.transform.rotationQuat).map((value) => value * RAD2DEG) as [number, number, number];
                return (
                  <div className="grid grid-cols-4 items-center gap-2">
                    <span className="text-slate-400">Rot X°</span>
                    <input
                      type="number"
                      className="col-span-3 rounded bg-slate-800 px-2 py-1"
                      step={1}
                      value={formatNumber(euler[0], 1)}
                      onChange={(event) =>
                        handleRotationChange(0, Number.parseFloat(event.target.value))
                      }
                    />
                    <span className="text-slate-400">Rot Y°</span>
                    <input
                      type="number"
                      className="col-span-3 rounded bg-slate-800 px-2 py-1"
                      step={1}
                      value={formatNumber(euler[1], 1)}
                      onChange={(event) =>
                        handleRotationChange(1, Number.parseFloat(event.target.value))
                      }
                    />
                    <span className="text-slate-400">Rot Z°</span>
                    <input
                      type="number"
                      className="col-span-3 rounded bg-slate-800 px-2 py-1"
                      step={1}
                      value={formatNumber(euler[2], 1)}
                      onChange={(event) =>
                        handleRotationChange(2, Number.parseFloat(event.target.value))
                      }
                    />
                  </div>
                );
              })()}
            </div>
          </section>
        )}

        {doorJoint && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-50">Door Angle</h3>
              <span className="text-xs text-slate-400">{formatNumber(doorAngleDeg, 1)}°</span>
            </div>
            <input
              type="range"
              min={0}
              max={90}
              step={1}
              value={doorAngleDeg}
              onChange={(event) => handleDoorAngleChange(Number.parseFloat(event.target.value))}
              className="w-full"
            />
            <p className="text-xs text-slate-400">
              Use the slider to set a target angle for the hinged door while in
              simulation mode. The joint motor will hold the selected position.
            </p>
          </section>
        )}

        <section className="space-y-2 rounded-md bg-slate-800/60 p-3 text-xs text-slate-300">
          <h3 className="text-sm font-semibold text-slate-200">Tips</h3>
          <ul className="space-y-1 list-disc pl-4">
            <li>Select parts from the list or click them in the viewport.</li>
            <li>Use the gizmo to move or rotate parts while in Edit mode.</li>
            <li>In Simulate mode, drive the rover with WASD or arrow keys.</li>
            <li>Door motors accept angle targets even while editing.</li>
          </ul>
        </section>
      </aside>

      <section className="flex-1 min-h-[600px]">
        <AssemblyCanvas
          blueprint={blueprint}
          catalog={catalog}
          mode={mode}
          selectedPartId={selectedPartId}
          onSelectPart={handleSelectPart}
          onTransformChange={handleTransformChange}
          transformMode={transformMode}
          jointTargets={activeJointTargets}
        />
        <div className="mt-4 grid gap-3 rounded-lg bg-slate-900/70 p-4 text-sm text-slate-200 shadow-inner">
          <div>
            <span className="font-semibold text-slate-100">Edit Mode:</span> Snap parts,
            adjust transforms, and configure joints. Gravity is disabled to make
            precise placement easier.
          </div>
          <div>
            <span className="font-semibold text-slate-100">Simulate Mode:</span> Rapier
            physics runs with gravity. Door joints respond to the angle slider,
            and the rover wheel motors are mapped to the keyboard.
          </div>
        </div>
      </section>
    </div>
  );
}

export default AssemblyEditor;
