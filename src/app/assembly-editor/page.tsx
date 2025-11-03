'use client'

import { useCallback, useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import { BlueprintCanvas } from '../../components/assembly/BlueprintCanvas'
import type { BlueprintRuntimeApi } from '../../components/assembly/BlueprintScene'
import {
  assemblyCatalog,
  blueprintExamples,
  getBlueprintPreset,
  listBlueprintOptions,
} from '../../lib/assemblyContent'
import type { Blueprint, JointInstance, PartInstance } from '../../types/assembly'
import { eulerDegToQuat, quatToEulerDeg } from '../../lib/assemblyMath'

const cloneBlueprint = (blueprint: Blueprint) => JSON.parse(JSON.stringify(blueprint)) as Blueprint

const formatNumber = (value: number, precision = 3) => Number.parseFloat(value.toFixed(precision))

type Axis = 0 | 1 | 2

type EulerTriple = [number, number, number]

const axisLabels: Record<Axis, string> = { 0: 'X', 1: 'Y', 2: 'Z' }

const PartTransformEditor = ({
  part,
  onUpdatePosition,
  onUpdateRotation,
  onReset,
  onImpulse,
}: {
  part: PartInstance
  onUpdatePosition: (axis: Axis, value: number) => void
  onUpdateRotation: (euler: EulerTriple) => void
  onReset: () => void
  onImpulse: (impulse: [number, number, number]) => void
}) => {
  const euler = useMemo(() => quatToEulerDeg(part.transform.rotationQuat), [part.transform.rotationQuat])

  const handlePositionChange = (axis: Axis, event: ChangeEvent<HTMLInputElement>) => {
    const value = Number.parseFloat(event.target.value)
    if (Number.isNaN(value)) return
    onUpdatePosition(axis, value)
  }

  const handleRotationChange = (axis: Axis, event: ChangeEvent<HTMLInputElement>) => {
    const value = Number.parseFloat(event.target.value)
    if (Number.isNaN(value)) return
    const next: EulerTriple = [...euler] as EulerTriple
    next[axis] = value
    onUpdateRotation(next)
  }

  const impulseOptions: Record<string, [number, number, number]> = {
    'Push Forward': [0, 0, -5],
    'Lift Up': [0, 5, 0],
    'Nudge Right': [3, 0, 0],
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Position (m)</h3>
        <div className="mt-2 grid grid-cols-3 gap-3">
          {[0, 1, 2].map((axis) => (
            <label key={axis} className="flex flex-col gap-1 text-xs">
              <span className="font-medium">{axisLabels[axis as Axis]}</span>
              <input
                type="number"
                step={0.1}
                value={formatNumber(part.transform.position[axis as Axis])}
                onChange={(event) => handlePositionChange(axis as Axis, event)}
                className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
              />
            </label>
          ))}
        </div>
      </div>
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Rotation (°)</h3>
        <div className="mt-2 grid grid-cols-3 gap-3">
          {[0, 1, 2].map((axis) => (
            <label key={axis} className="flex flex-col gap-1 text-xs">
              <span className="font-medium">{axisLabels[axis as Axis]}</span>
              <input
                type="number"
                step={1}
                value={formatNumber(euler[axis as Axis])}
                onChange={(event) => handleRotationChange(axis as Axis, event)}
                className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
              />
            </label>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {Object.entries(impulseOptions).map(([label, vector]) => (
          <button
            key={label}
            type="button"
            onClick={() => onImpulse(vector)}
            className="rounded border border-neutral-700 px-2 py-1 text-xs hover:border-amber-400 hover:text-amber-300"
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={onReset}
          className="rounded border border-red-700 px-2 py-1 text-xs text-red-300 hover:bg-red-900/30"
        >
          Reset Transform
        </button>
      </div>
      <div className="rounded border border-neutral-800 bg-neutral-950/80 p-3 text-xs text-neutral-400">
        <p>Tip: hold <strong>Alt</strong> while dragging number inputs to nudge values precisely.</p>
      </div>
    </div>
  )
}

const JointInspector = ({
  joint,
  templateName,
  onSetVelocity,
  onNudge,
}: {
  joint: JointInstance
  templateName: string
  onSetVelocity: (velocity: number) => void
  onNudge: (velocity: number) => void
}) => {
  const currentTarget = joint.driveOverride?.target ?? 0
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Joint Info</h3>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-xs text-neutral-300">
          <dt className="font-semibold text-neutral-400">Template</dt>
          <dd>{templateName}</dd>
          <dt className="font-semibold text-neutral-400">Type</dt>
          <dd>{joint.template}</dd>
          {joint.articulationGroup ? (
            <>
              <dt className="font-semibold text-neutral-400">Articulation</dt>
              <dd>{joint.articulationGroup}</dd>
            </>
          ) : null}
        </dl>
      </div>
      <div>
        <label className="flex flex-col gap-2 text-xs text-neutral-200">
          <span className="font-semibold uppercase tracking-wide text-neutral-400">
            Motor Target Velocity (rad/s)
          </span>
          <input
            type="range"
            min={-15}
            max={15}
            step={0.1}
            value={currentTarget}
            onChange={(event) => onSetVelocity(Number.parseFloat(event.target.value))}
          />
          <input
            type="number"
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
            value={formatNumber(currentTarget)}
            step={0.1}
            onChange={(event) => onSetVelocity(Number.parseFloat(event.target.value))}
          />
        </label>
      </div>
      <div className="flex gap-2 text-xs">
        <button
          type="button"
          onClick={() => onNudge(4)}
          className="rounded border border-emerald-600 px-3 py-1 text-emerald-200 hover:bg-emerald-900/40"
        >
          Nudge +
        </button>
        <button
          type="button"
          onClick={() => onNudge(-4)}
          className="rounded border border-blue-700 px-3 py-1 text-blue-200 hover:bg-blue-900/40"
        >
          Nudge -
        </button>
        <button
          type="button"
          onClick={() => onSetVelocity(0)}
          className="rounded border border-neutral-600 px-3 py-1 text-neutral-200 hover:bg-neutral-800/50"
        >
          Stop
        </button>
      </div>
      <div className="rounded border border-neutral-800 bg-neutral-950/80 p-3 text-xs text-neutral-400">
        <p>
          Use <strong>Nudge</strong> to kick the articulation open/closed. Set target velocity for continuous motion
          (car wheels) or zero it out to hold position.
        </p>
      </div>
    </div>
  )
}

const BlueprintJsonPreview = ({ blueprint }: { blueprint: Blueprint }) => {
  const json = useMemo(() => JSON.stringify(blueprint, null, 2), [blueprint])
  return (
    <pre className="max-h-64 overflow-auto rounded border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-300">
      {json}
    </pre>
  )
}

export default function AssemblyEditorPage() {
  const [selectedExample, setSelectedExample] = useState('example-house')
  const [blueprint, setBlueprint] = useState<Blueprint>(() => getBlueprintPreset('example-house'))
  const [selectedPartId, setSelectedPartId] = useState<string | null>('pi_door')
  const [selectedJointId, setSelectedJointId] = useState<string | null>('joint_door')
  const [showSockets, setShowSockets] = useState(true)
  const [showJointDebug, setShowJointDebug] = useState(true)
  const [manualWheelVelocity, setManualWheelVelocity] = useState(0)
  const [runtimeApi, setRuntimeApi] = useState<BlueprintRuntimeApi | null>(null)

  const exampleOptions = useMemo(() => listBlueprintOptions(), [])

  const handleExampleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const exampleId = event.target.value
    setSelectedExample(exampleId)
    const fresh = getBlueprintPreset(exampleId)
    setBlueprint(fresh)
    setSelectedPartId(fresh.root.parts[0]?.id ?? null)
    setSelectedJointId(fresh.root.joints[0]?.id ?? null)
    setManualWheelVelocity(0)
    runtimeApi?.setManualWheelVelocity(0)
  }

  const handleResetExample = () => {
    const fresh = getBlueprintPreset(selectedExample)
    setBlueprint(fresh)
    setManualWheelVelocity(0)
    runtimeApi?.setManualWheelVelocity(0)
  }

  const selectedPart = selectedPartId ? blueprint.root.parts.find((part) => part.id === selectedPartId) : null
  const selectedJoint = selectedJointId ? blueprint.root.joints.find((joint) => joint.id === selectedJointId) : null

  const updatePartPosition = useCallback(
    (partId: string, axis: Axis, value: number) => {
      setBlueprint((prev) => {
        const next = cloneBlueprint(prev)
        const part = next.root.parts.find((candidate) => candidate.id === partId)
        if (!part) return prev
        part.transform.position[axis] = value
        return next
      })
    },
    [],
  )

  const updatePartRotation = useCallback((partId: string, euler: EulerTriple) => {
    setBlueprint((prev) => {
      const next = cloneBlueprint(prev)
      const part = next.root.parts.find((candidate) => candidate.id === partId)
      if (!part) return prev
      part.transform.rotationQuat = eulerDegToQuat(euler)
      return next
    })
  }, [])

  const resetPartTransform = useCallback(
    (partId: string) => {
      setBlueprint((prev) => {
        const baseline = getBlueprintPreset(selectedExample)
        const baselinePart = baseline.root.parts.find((candidate) => candidate.id === partId)
        if (!baselinePart) return prev
        const next = cloneBlueprint(prev)
        const part = next.root.parts.find((candidate) => candidate.id === partId)
        if (!part) return prev
        part.transform = JSON.parse(JSON.stringify(baselinePart.transform))
        return next
      })
    },
    [selectedExample],
  )

  const handleJointVelocity = useCallback(
    (jointId: string, velocity: number) => {
      setBlueprint((prev) => {
        const next = cloneBlueprint(prev)
        const joint = next.root.joints.find((candidate) => candidate.id === jointId)
        if (!joint) return prev
        joint.driveOverride = { ...(joint.driveOverride ?? {}), mode: 'velocity', target: velocity }
        return next
      })
      runtimeApi?.setJointMotorTarget(jointId, velocity)
    },
    [runtimeApi],
  )

  const handleJointNudge = useCallback(
    (jointId: string, velocity: number) => {
      runtimeApi?.nudgeJoint(jointId, velocity * 2, 350)
    },
    [runtimeApi],
  )

  const handleRuntimeReady = useCallback((api: BlueprintRuntimeApi | null) => {
    setRuntimeApi(api)
    if (api) {
      setManualWheelVelocity(api.getManualWheelVelocity())
    }
  }, [])

  const handleManualDriveChange = useCallback(
    (value: number) => {
      setManualWheelVelocity(value)
      runtimeApi?.setManualWheelVelocity(value)
    },
    [runtimeApi],
  )

  const selectedJointTemplateName = useMemo(() => {
    if (!selectedJoint) return ''
    return assemblyCatalog.jointTemplates?.[selectedJoint.template]?.id ?? selectedJoint.template
  }, [selectedJoint])

  const activeExample = blueprintExamples.find((example) => example.id === selectedExample)

  return (
    <div className="flex min-h-screen flex-col bg-neutral-950 text-neutral-200">
      <header className="border-b border-neutral-900 bg-neutral-950/90 px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-white">Assembly Playground</h1>
            <p className="text-sm text-neutral-400">
              Build articulated structures with Three.js, React-Three-Fiber, and Rapier. Choose a preset and start
              editing parts, sockets, and joints live.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-sm">
              <span className="mr-2 text-neutral-400">Example</span>
              <select
                value={selectedExample}
                onChange={handleExampleChange}
                className="rounded border border-neutral-700 bg-neutral-900 px-3 py-1 text-sm"
              >
                {exampleOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.title}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={handleResetExample}
              className="rounded border border-neutral-700 px-3 py-1 text-sm text-neutral-200 hover:border-amber-400 hover:text-amber-200"
            >
              Reset Example
            </button>
            <label className="flex items-center gap-2 text-xs text-neutral-400">
              <input
                type="checkbox"
                checked={showSockets}
                onChange={(event) => setShowSockets(event.target.checked)}
              />
              Show sockets
            </label>
            <label className="flex items-center gap-2 text-xs text-neutral-400">
              <input
                type="checkbox"
                checked={showJointDebug}
                onChange={(event) => setShowJointDebug(event.target.checked)}
              />
              Show joints
            </label>
          </div>
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <aside className="flex w-72 flex-col border-r border-neutral-900 bg-neutral-950/80">
          <div className="flex-1 overflow-y-auto p-4">
            {activeExample ? (
              <div className="mb-4 rounded border border-neutral-800 bg-neutral-900/60 p-3 text-xs text-neutral-300">
                {activeExample.summary}
              </div>
            ) : null}
            <div>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-400">Parts</h2>
              <div className="space-y-2">
                {blueprint.root.parts.map((part) => (
                  <button
                    key={part.id}
                    type="button"
                    onClick={() => {
                      setSelectedPartId(part.id)
                      setSelectedJointId(null)
                    }}
                    className={`w-full rounded border px-3 py-2 text-left text-sm transition hover:border-amber-400 hover:text-amber-200 ${selectedPartId === part.id ? 'border-amber-500 bg-amber-500/10 text-amber-200' : 'border-neutral-800 bg-neutral-900/50 text-neutral-200'}`}
                  >
                    <span className="block font-semibold">{part.label ?? part.id}</span>
                    <span className="text-xs text-neutral-400">{part.partId}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-6">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-400">Joints</h2>
              <div className="space-y-2">
                {blueprint.root.joints.map((joint) => (
                  <button
                    key={joint.id}
                    type="button"
                    onClick={() => {
                      setSelectedJointId(joint.id)
                      setSelectedPartId(null)
                    }}
                    className={`w-full rounded border px-3 py-2 text-left text-sm transition hover:border-sky-400 hover:text-sky-200 ${selectedJointId === joint.id ? 'border-sky-500 bg-sky-500/10 text-sky-100' : 'border-neutral-800 bg-neutral-900/50 text-neutral-200'}`}
                  >
                    <span className="block font-semibold">{joint.label ?? joint.id}</span>
                    <span className="text-xs text-neutral-400">{joint.template}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 min-h-0">
            <BlueprintCanvas
              key={`${blueprint.id}-${selectedExample}`}
              blueprint={blueprint}
              catalog={assemblyCatalog}
              selectedPartId={selectedPartId}
              selectedJointId={selectedJointId}
              onSelectPart={setSelectedPartId}
              onSelectJoint={setSelectedJointId}
              onRuntimeReady={handleRuntimeReady}
              showSockets={showSockets}
              showJointDebug={showJointDebug}
              variantKey={selectedExample}
            />
          </div>
          <div className="border-t border-neutral-900 bg-neutral-950/80 p-4">
            <BlueprintJsonPreview blueprint={blueprint} />
          </div>
        </main>
        <aside className="w-96 border-l border-neutral-900 bg-neutral-950/85 p-5">
          {selectedPart && (
            <section className="space-y-4">
              <h2 className="text-lg font-semibold text-white">Part Inspector</h2>
              <PartTransformEditor
                part={selectedPart}
                onUpdatePosition={(axis, value) => updatePartPosition(selectedPart.id, axis, value)}
                onUpdateRotation={(euler) => updatePartRotation(selectedPart.id, euler)}
                onReset={() => resetPartTransform(selectedPart.id)}
                onImpulse={(vector) => runtimeApi?.applyImpulseToPart(selectedPart.id, vector)}
              />
              <div className="rounded border border-neutral-800 bg-neutral-900/50 p-3 text-xs text-neutral-400">
                <p>
                  Selected part: <strong>{selectedPart.partId}</strong>
                </p>
                {selectedPart.label ? (
                  <p>Label: {selectedPart.label}</p>
                ) : null}
              </div>
            </section>
          )}
          {selectedJoint && (
            <section className="mt-6 space-y-4">
              <h2 className="text-lg font-semibold text-white">Joint Inspector</h2>
              <JointInspector
                joint={selectedJoint}
                templateName={selectedJointTemplateName}
                onSetVelocity={(velocity) => handleJointVelocity(selectedJoint.id, velocity)}
                onNudge={(velocity) => handleJointNudge(selectedJoint.id, velocity)}
              />
            </section>
          )}
          {selectedExample === 'example-car' ? (
            <section className="mt-8 space-y-3">
              <h2 className="text-lg font-semibold text-white">Drivetrain Controls</h2>
              <p className="text-xs text-neutral-400">
                Use <strong>W/S</strong> to accelerate or reverse. <strong>A/D</strong> adds steering bias. Adjust the base motor
                target below for cruise control.
              </p>
              <label className="flex flex-col gap-2 text-xs text-neutral-300">
                <span className="font-semibold uppercase tracking-wide text-neutral-400">Manual Motor Target (rad/s)</span>
                <input
                  type="range"
                  min={-12}
                  max={12}
                  step={0.1}
                  value={manualWheelVelocity}
                  onChange={(event) => handleManualDriveChange(Number.parseFloat(event.target.value))}
                />
                <input
                  type="number"
                  className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
                  value={manualWheelVelocity}
                  step={0.1}
                  onChange={(event) => handleManualDriveChange(Number.parseFloat(event.target.value))}
                />
              </label>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  )
}
