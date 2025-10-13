export function ControlsHelp({ isLocked }: { isLocked: boolean }) {
  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-3">
      <h3 className="text-xs font-semibold text-white mb-2">🎮 Controls</h3>
      
      <div className="space-y-2 text-[10px]">
        {/* Movement Controls */}
        <div>
          <div className="font-semibold text-blue-300 mb-0.5">WASD Move · Mouse Look · Space Jump · Shift Sprint {isLocked ? '✓' : '(click view)'}</div>
        </div>
        
        {/* Status */}
        <div className="flex gap-3 text-gray-300">
          <span>Lock: <span className={isLocked ? "text-green-400" : "text-red-400"}>
            {isLocked ? '✓' : '✗'}
          </span></span>
          <span>AI: <span className="text-green-400">✓</span></span>
          <span>Physics: <span className="text-green-400">✓</span></span>
        </div>
      </div>
    </div>
  )
}

export function WorldCapabilities() {
  return (
    <div className="bg-blue-900/30 border border-blue-700 rounded-lg p-2">
      <div className="text-[10px] space-y-1">
        <div className="font-semibold text-blue-200">✨ What Works</div>
        <div className="text-blue-100 space-y-0.5">
          <div>✅ 3D Movement · AI Chat · World Inspection · NPC Commands</div>
          <div>⏳ NPC Movement · Inventory Interactions</div>
        </div>
      </div>
    </div>
  )
}

