'use client'

import { useState } from 'react'
import { N } from '../lib/bunker-world'
import type { NodeId } from '../lib/bunker-world'

interface PlannerState {
  agentAt: NodeId
  keyOnTable: boolean
  c4Available: boolean
  starPresent: boolean
  hasKey: boolean
  hasC4: boolean
  hasStar: boolean
  storageUnlocked: boolean
  c4Placed: boolean
  bunkerBreached: boolean
}

interface PlannerGoal {
  agentAt?: NodeId
  hasKey?: boolean
  hasC4?: boolean
  bunkerBreached?: boolean
  hasStar?: boolean
}

interface PlannerControlsProps {
  initialState: PlannerState
  goalState: PlannerGoal
  autoRun: boolean
  showPlanVis: boolean
  isPlanning: boolean
  onInitialStateChange: (state: PlannerState) => void
  onGoalStateChange: (goal: PlannerGoal) => void
  onAutoRunChange: (enabled: boolean) => void
  onShowPlanVisChange: (enabled: boolean) => void
  onRunPlan: () => void
}

const nodeOptions: Array<{ id: NodeId; label: string; category: string }> = [
  { id: N.COURTYARD, label: 'Courtyard', category: 'outdoor' },
  { id: N.TABLE, label: 'Table', category: 'outdoor' },
  { id: N.STORAGE_DOOR, label: 'Storage Door', category: 'storage' },
  { id: N.STORAGE_INT, label: 'Storage Interior', category: 'storage' },
  { id: N.C4_TABLE, label: 'C4 Table', category: 'storage' },
  { id: N.BUNKER_DOOR, label: 'Bunker Door', category: 'bunker' },
  { id: N.BUNKER_INT, label: 'Bunker Interior', category: 'bunker' },
  { id: N.STAR, label: 'Star Location', category: 'bunker' },
  { id: N.SAFE, label: 'Safe Zone', category: 'outdoor' },
]

const categoryColors: Record<string, string> = {
  outdoor: 'bg-emerald-100 text-emerald-800',
  storage: 'bg-amber-100 text-amber-800',
  bunker: 'bg-purple-100 text-purple-800',
}

const categoryIcons: Record<string, string> = {
  outdoor: '🌿',
  storage: '📦',
  bunker: '🏰',
}

const ToggleSwitch: React.FC<{
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}> = ({ label, checked, onChange, disabled }) => (
  <button
    type="button"
    className={`flex items-center justify-between py-1 px-2 -mx-2 rounded transition-all w-full text-left ${
      disabled 
        ? 'opacity-50 cursor-not-allowed' 
        : 'cursor-pointer hover:bg-gray-600/30 active:bg-gray-600/50 focus:outline-none focus:ring-1 focus:ring-blue-500/50'
    }`}
    onClick={() => !disabled && onChange(!checked)}
    disabled={disabled}
    aria-pressed={checked}
  >
    <span className="text-xs text-gray-300 select-none">
      {label}
    </span>
    <div
      className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
        checked ? 'bg-blue-600' : 'bg-gray-600'
      }`}
    >
      <span
        className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-3.5' : 'translate-x-0.5'
        }`}
      />
    </div>
  </button>
)

const LocationSelector: React.FC<{
  value: NodeId | undefined
  onChange: (value: NodeId | undefined) => void
  placeholder?: string
  allowEmpty?: boolean
}> = ({ value, onChange, placeholder = "Select location", allowEmpty = false }) => {
  const [isOpen, setIsOpen] = useState(false)

  const selectedOption = value ? nodeOptions.find(opt => opt.id === value) : null
  
  return (
    <div className="relative">
      <button
        type="button"
        className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-left text-xs text-gray-300 hover:bg-gray-650 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {selectedOption && (
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium ${categoryColors[selectedOption.category]}`}>
                <span>{categoryIcons[selectedOption.category]}</span>
                {selectedOption.label}
              </span>
            )}
            {!selectedOption && (
              <span className="text-gray-500">{placeholder}</span>
            )}
          </div>
          <svg className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {isOpen && (
        <div className="absolute z-10 w-full mt-0.5 bg-gray-700 border border-gray-600 rounded shadow-lg max-h-48 overflow-auto">
          {allowEmpty && (
            <button
              type="button"
              className="w-full px-2 py-1 text-left text-xs text-gray-400 hover:bg-gray-600 transition-colors"
              onClick={() => {
                onChange(undefined)
                setIsOpen(false)
              }}
            >
              (none)
            </button>
          )}
          {Object.entries(
            nodeOptions.reduce((acc, option) => {
              if (!acc[option.category]) acc[option.category] = []
              acc[option.category].push(option)
              return acc
            }, {} as Record<string, typeof nodeOptions>)
          ).map(([category, options]) => (
            <div key={category}>
              <div className="px-2 py-1 text-xs font-semibold text-gray-400 uppercase tracking-wide bg-gray-800 sticky top-0">
                <span className="flex items-center gap-1.5">
                  <span>{categoryIcons[category as keyof typeof categoryIcons]}</span>
                  {category}
                </span>
              </div>
              {options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`w-full px-2 py-1 text-left text-xs transition-colors ${
                    value === option.id
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-300 hover:bg-gray-600'
                  }`}
                  onClick={() => {
                    onChange(option.id)
                    setIsOpen(false)
                  }}
                >
                  <span className="flex items-center justify-between">
                    {option.label}
                    {value === option.id && (
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export const PlannerControls: React.FC<PlannerControlsProps> = ({
  initialState,
  goalState,
  autoRun,
  showPlanVis,
  isPlanning,
  onInitialStateChange,
  onGoalStateChange,
  onAutoRunChange,
  onShowPlanVisChange,
  onRunPlan,
}) => {
  const updateInitialState = (key: keyof PlannerState, value: NodeId | boolean) => {
    onInitialStateChange({ ...initialState, [key]: value })
  }

  const updateGoalState = (key: keyof PlannerGoal, value: NodeId | boolean | undefined) => {
    onGoalStateChange({ ...goalState, [key]: value })
  }

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
      {/* Header */}
      <div className="bg-gray-750 px-3 py-2 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white flex items-center gap-1.5">
            <span className="text-blue-400 text-sm">🎯</span>
            Planner Controls
          </h2>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <input
                type="checkbox"
                id="autoRun"
                checked={autoRun}
                onChange={(e) => onAutoRunChange(e.target.checked)}
                className="w-3 h-3 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500 focus:ring-1"
              />
              <label htmlFor="autoRun" className="text-xs text-gray-300">Auto-run</label>
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="checkbox"
                id="showPlanVis"
                checked={showPlanVis}
                onChange={(e) => onShowPlanVisChange(e.target.checked)}
                className="w-3 h-3 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500 focus:ring-1"
              />
              <label htmlFor="showPlanVis" className="text-xs text-gray-300">Show visualization</label>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-gray-700">
        {/* Initial State */}
        <div className="p-3">
          <div className="mb-2">
            <h3 className="text-xs font-semibold text-gray-200 uppercase tracking-wide mb-1 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
              Initial State
            </h3>
          </div>

          <div className="space-y-2">
            <div>
              <h4 className="block text-xs font-medium text-gray-300 mb-1">Agent Location</h4>
              <LocationSelector
                value={initialState.agentAt}
                onChange={(value) => updateInitialState('agentAt', value || N.COURTYARD)}
                placeholder="Select starting location"
              />
            </div>

            <div className="space-y-1">
              <h4 className="text-xs font-medium text-gray-300 mb-1">World Objects</h4>
              <div className="bg-gray-750 rounded p-2 space-y-1">
                <ToggleSwitch
                  label="🗝️ Key on Table"
                  checked={initialState.keyOnTable}
                  onChange={(value) => updateInitialState('keyOnTable', value)}
                />
                <ToggleSwitch
                  label="💣 C4 Available"
                  checked={initialState.c4Available}
                  onChange={(value) => updateInitialState('c4Available', value)}
                />
                <ToggleSwitch
                  label="⭐ Star Present"
                  checked={initialState.starPresent}
                  onChange={(value) => updateInitialState('starPresent', value)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <h4 className="text-xs font-medium text-gray-300 mb-1">Agent Inventory</h4>
              <div className="bg-gray-750 rounded p-2 space-y-1">
                <ToggleSwitch
                  label="🗝️ Has Key"
                  checked={initialState.hasKey}
                  onChange={(value) => updateInitialState('hasKey', value)}
                />
                <ToggleSwitch
                  label="💣 Has C4"
                  checked={initialState.hasC4}
                  onChange={(value) => updateInitialState('hasC4', value)}
                />
                <ToggleSwitch
                  label="⭐ Has Star"
                  checked={initialState.hasStar}
                  onChange={(value) => updateInitialState('hasStar', value)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <h4 className="text-xs font-medium text-gray-300 mb-1">World State</h4>
              <div className="bg-gray-750 rounded p-2 space-y-1">
                <ToggleSwitch
                  label="🔓 Storage Unlocked"
                  checked={initialState.storageUnlocked}
                  onChange={(value) => updateInitialState('storageUnlocked', value)}
                />
                <ToggleSwitch
                  label="💥 C4 Placed"
                  checked={initialState.c4Placed}
                  onChange={(value) => updateInitialState('c4Placed', value)}
                />
                <ToggleSwitch
                  label="🚪 Bunker Breached"
                  checked={initialState.bunkerBreached}
                  onChange={(value) => updateInitialState('bunkerBreached', value)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Goal State */}
        <div className="p-3">
          <div className="mb-2">
            <h3 className="text-xs font-semibold text-gray-200 uppercase tracking-wide mb-1 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
              Goal State
            </h3>
          </div>

          <div className="space-y-2">
            <div>
              <h4 className="block text-xs font-medium text-gray-300 mb-1">Target Location</h4>
              <LocationSelector
                value={goalState.agentAt}
                onChange={(value) => updateGoalState('agentAt', value)}
                placeholder="Any location"
                allowEmpty={true}
              />
            </div>

            <div className="space-y-1">
              <h4 className="text-xs font-medium text-gray-300 mb-1">Required Items</h4>
              <div className="bg-gray-750 rounded p-2 space-y-1">
                <ToggleSwitch
                  label="🗝️ Must Have Key"
                  checked={goalState.hasKey || false}
                  onChange={(value) => updateGoalState('hasKey', value || undefined)}
                />
                <ToggleSwitch
                  label="💣 Must Have C4"
                  checked={goalState.hasC4 || false}
                  onChange={(value) => updateGoalState('hasC4', value || undefined)}
                />
                <ToggleSwitch
                  label="⭐ Must Have Star"
                  checked={goalState.hasStar || false}
                  onChange={(value) => updateGoalState('hasStar', value || undefined)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <h4 className="text-xs font-medium text-gray-300 mb-1">Required Actions</h4>
              <div className="bg-gray-750 rounded p-2 space-y-1">
                <ToggleSwitch
                  label="🚪 Must Breach Bunker"
                  checked={goalState.bunkerBreached || false}
                  onChange={(value) => updateGoalState('bunkerBreached', value || undefined)}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="bg-gray-750 px-3 py-2 border-t border-gray-700">
        <button
          type="button"
          onClick={onRunPlan}
          disabled={isPlanning}
          className={`w-full font-medium py-2 px-3 rounded-lg transition-all duration-200 text-sm ${
            isPlanning
              ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg hover:shadow-xl transform hover:-translate-y-0.5'
          }`}
        >
          {isPlanning ? (
            <span className="flex items-center justify-center gap-1.5">
              <svg className="w-3 h-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Planning...
            </span>
          ) : (
            <span className="flex items-center justify-center gap-1.5">
              <span className="text-sm">🚀</span>
              Execute Plan
            </span>
          )}
        </button>
      </div>
    </div>
  )
}

export default PlannerControls
