import type { World } from './actions'

export function DetailedWorldState({ 
  world
}: { 
  world: World | null
}) {
  if (!world) return null
  
  const agents = Array.from(world.agents.entries())
  const items = Array.from(world.items.entries())
  const machines = Array.from(world.machines.entries())
  
  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-3">
      <h3 className="text-sm font-semibold text-white mb-3">🌍 World State</h3>
      
      {/* Multi-column layout for better horizontal space usage */}
      <div className="grid grid-cols-3 gap-3">
        
        {/* Column 1: Positions & NPC States */}
        <div className="space-y-3">
          {/* Positions */}
          <div>
            <div className="text-xs font-semibold text-gray-300 mb-2">📍 Positions</div>
            <div className="space-y-1 text-xs">
              {agents.map(([id, agent]) => {
                const pos = world.positions.get(id)
                const isPlayer = id.startsWith('player')
                return (
                  <div key={id} className="flex flex-col">
                    <span className={isPlayer ? "text-blue-300" : "text-pink-300"}>
                      {isPlayer ? "👤 You" : `🤖 ${agent.name}`}
                    </span>
                    <span className="text-gray-400 font-mono text-[10px] ml-3">
                      {pos ? `(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${(pos.z ?? 0).toFixed(1)})` : 'unknown'}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
          
          {/* NPC States */}
          <div>
            <div className="text-xs font-semibold text-gray-300 mb-2">🤖 NPC States</div>
            {agents.filter(([id]) => !id.startsWith('player')).map(([id, agent]) => {
              const inv = world.inventories.get(id)
              return (
                <div key={id} className="mb-2 p-2 bg-gray-900/50 rounded">
                  <div className="text-xs font-semibold text-white mb-1">{agent.name}</div>
                  <div className="space-y-0.5 text-[10px] text-gray-400">
                    <div>Faction: <span className="text-gray-300">{agent.faction}</span></div>
                    <div>Speed: <span className="text-gray-300">{agent.speed.toFixed(1)} m/s</span></div>
                    <div>Traits: <span className="text-gray-300">{agent.traits.join(', ') || 'none'}</span></div>
                    <div>Inventory: <span className="text-gray-300">{inv?.items.length || 0} items</span></div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        
        {/* Column 2: Inventories */}
        <div>
          <div className="text-xs font-semibold text-gray-300 mb-2">🎒 Inventories</div>
          {agents.map(([id, agent]) => {
            const inv = world.inventories.get(id)
            if (!inv) return null
            const isPlayer = id.startsWith('player')
            
            return (
              <div key={id} className="mb-3 p-2 bg-gray-900/50 rounded">
                <div className="text-xs font-semibold mb-1" style={{ color: isPlayer ? '#60a5fa' : '#ec4899' }}>
                  {isPlayer ? '👤 Your Inventory' : `${agent.name}`}
                </div>
                {inv.items.length === 0 ? (
                  <div className="text-[10px] text-gray-500 italic">Empty</div>
                ) : (
                  <div className="space-y-0.5">
                    {inv.items.map(itemId => {
                      const item = world.items.get(itemId)
                      return (
                        <div key={itemId} className="text-[10px] text-gray-300 flex items-center gap-1">
                          <span className="text-yellow-400">•</span>
                          <span>{item?.name || itemId}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
                <div className="text-[10px] text-gray-500 mt-1">
                  {inv.items.length}/{inv.capacitySlots} slots
                </div>
              </div>
            )
          })}
        </div>
        
        {/* Column 3: Objects & Machines */}
        <div className="space-y-3">
          {/* Objects in World */}
          <div>
            <div className="text-xs font-semibold text-gray-300 mb-2">📦 Objects</div>
            <div className="space-y-2">
              {(() => {
                const itemsByLocation = new Map<string, typeof items>()
                items.forEach(([id, item]) => {
                  const pos = world.positions.get(id)
                  if (!pos) return
                  // Check if in inventory
                  let inInventory = false
                  for (const [, inv] of world.inventories.entries()) {
                    if (inv.items.includes(id)) {
                      inInventory = true
                      break
                    }
                  }
                  if (inInventory) return
                  
                  const locKey = pos.room || `(${pos.x.toFixed(0)}, ${pos.z?.toFixed(0) ?? 0})`
                  if (!itemsByLocation.has(locKey)) {
                    itemsByLocation.set(locKey, [])
                  }
                  itemsByLocation.get(locKey)?.push([id, item])
                })
                
                return Array.from(itemsByLocation.entries()).map(([location, locItems]) => (
                  <div key={location} className="text-xs p-2 bg-gray-900/50 rounded">
                    <div className="text-gray-300 font-semibold mb-1">{location}</div>
                    <div className="space-y-0.5">
                      {locItems.map(([id, item]) => (
                        <div key={id} className="text-[10px] text-gray-400 flex items-center gap-1">
                          <span className="text-green-400">•</span>
                          <span>{item.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              })()}
            </div>
          </div>
          
          {/* Machines */}
          <div>
            <div className="text-xs font-semibold text-gray-300 mb-2">⚙️ Machines</div>
            <div className="space-y-2">
              {machines.map(([id, machine]) => {
                const pos = world.positions.get(id)
                return (
                  <div key={id} className="text-xs bg-gray-900/50 rounded p-2">
                    <div className="font-semibold text-purple-300 mb-1">{machine.name}</div>
                    <div className="text-[10px] text-gray-400 space-y-0.5">
                      <div>Status: <span className={machine.powered ? "text-green-400" : "text-red-400"}>
                        {machine.powered ? '✓ Powered' : '✗ Offline'}
                      </span></div>
                      <div>Location: <span className="text-gray-300">
                        {pos?.room || 'unknown'}
                      </span></div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          
          {/* Summary */}
          <div className="pt-2 border-t border-gray-700 text-[10px] text-gray-500">
            <div>{agents.length} agents • {items.length} items • {machines.length} machines</div>
          </div>
        </div>
      </div>
    </div>
  )
}

