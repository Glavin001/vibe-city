import type { NodeId } from '../../lib/bunker-world'
import { NODE_TITLES } from '../../lib/npc-commands'

export function LocationPicker({ onSelect, onClose }: { 
  onSelect: (location: NodeId) => void
  onClose: () => void 
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-md w-full">
        <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">📍 Select Location</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
            type="button"
          >
            ✕
          </button>
        </div>
        <div className="p-4 grid grid-cols-2 gap-2">
          {Object.entries(NODE_TITLES).map(([nodeId, title]) => (
            <button
              key={nodeId}
              className="text-sm px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg text-left"
              onClick={() => {
                onSelect(nodeId as NodeId)
                onClose()
              }}
              type="button"
            >
              {title}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

