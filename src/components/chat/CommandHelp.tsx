import { COMMAND_DEFINITIONS, getLocationsList } from '../../lib/npc-commands'

export function CommandHelp({ onClose }: { onClose: () => void }) {
  const categories = {
    control: { title: '🎛️ Control Commands', items: [] as typeof COMMAND_DEFINITIONS },
    movement: { title: '🚶 Movement Commands', items: [] as typeof COMMAND_DEFINITIONS },
    action: { title: '⚡ Action Commands', items: [] as typeof COMMAND_DEFINITIONS },
    planner: { title: '🤖 AI Planner', items: [] as typeof COMMAND_DEFINITIONS },
  }
  
  // Group commands by category
  COMMAND_DEFINITIONS.forEach(cmd => {
    if (categories[cmd.category]) {
      categories[cmd.category].items.push(cmd)
    }
  })
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-3xl w-full max-h-[80vh] overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">📖 Command Reference</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
            type="button"
          >
            ✕
          </button>
        </div>
        <div className="p-4 overflow-y-auto max-h-[calc(80vh-60px)]">
          {/* General syntax info */}
          <div className="mb-6 p-4 bg-gray-700/50 rounded-lg">
            <h3 className="text-sm font-semibold text-cyan-400 mb-2">💡 Tips</h3>
            <ul className="text-sm text-gray-300 space-y-1">
              <li>• Chain commands with commas, semicolons, "and", or "then"</li>
              <li>• Example: <code className="bg-gray-900 px-1 rounded">move to table, pick up key, then go to storage door</code></li>
              <li>• Available locations: <code className="bg-gray-900 px-1 rounded">{getLocationsList()}</code></li>
              <li>• Use the AI planner: <code className="bg-gray-900 px-1 rounded">plan get star</code> to auto-generate action sequences</li>
            </ul>
          </div>
          
          {/* Command categories */}
          {Object.entries(categories).map(([key, cat]) => (
            cat.items.length > 0 && (
              <div key={key} className="mb-6">
                <h3 className="text-sm font-semibold text-white mb-3">{cat.title}</h3>
                <div className="space-y-3">
                  {cat.items.map(cmd => (
                    <div key={cmd.id} className="bg-gray-700/30 rounded-lg p-3">
                      <div className="flex items-start justify-between mb-1">
                        <h4 className="text-sm font-medium text-white">{cmd.buttonLabel}</h4>
                      </div>
                      <p className="text-xs text-gray-400 mb-2">{cmd.description}</p>
                      <div className="flex flex-wrap gap-2">
                        {cmd.examples.map((ex) => (
                          <code key={ex} className="text-xs bg-gray-900 px-2 py-1 rounded text-cyan-300">
                            {ex}
                          </code>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          ))}
          
          {/* Special commands */}
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-white mb-3">🤖 AI Planner</h3>
            <div className="bg-gray-700/30 rounded-lg p-3">
              <p className="text-xs text-gray-400 mb-2">Automatically plan complex sequences</p>
              <div className="flex flex-wrap gap-2">
                <code className="text-xs bg-gray-900 px-2 py-1 rounded text-cyan-300">plan get star</code>
                <code className="text-xs bg-gray-900 px-2 py-1 rounded text-cyan-300">has star</code>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

