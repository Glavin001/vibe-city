import type { World } from './actions'
import type { AgentPose } from './types'

/* ============================= WORLD STATUS PANEL ============================= */

export function WorldStatusPanel({ 
  world, 
  playerPose 
}: { 
  world: World | null
  playerPose: AgentPose 
}) {
  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
      <h3 className="text-sm font-semibold text-white mb-3">World Status</h3>
      <div className="space-y-2 text-xs">
        <div className="flex justify-between">
          <span className="text-gray-400">Player Position:</span>
          <span className="text-white font-mono">
            {playerPose.position.map(v => v.toFixed(1)).join(', ')}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Agents:</span>
          <span className="text-white">{world?.agents.size || 0}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Items:</span>
          <span className="text-white">{world?.items.size || 0}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Machines:</span>
          <span className="text-white">{world?.machines.size || 0}</span>
        </div>
      </div>
    </div>
  )
}

/* ============================= ACTION LOG ============================= */

export function ActionLog({ logs }: { logs: string[] }) {
  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-3 h-full flex flex-col">
      <div className="text-xs font-semibold text-gray-400 mb-2">Action Log</div>
      <div className="flex-1 overflow-y-auto">
        {logs.length === 0 ? (
          <div className="text-xs text-gray-500 italic">No actions yet...</div>
        ) : (
          <div className="space-y-1">
            {logs.slice(-20).map((log, idx) => (
              <div key={`log-${idx}-${log.slice(0, 20)}`} className="text-xs text-gray-300 font-mono">
                {log}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ============================= CHAT PANEL ============================= */

export function ChatPanel({ 
  messages, 
  status, 
  error, 
  input, 
  setInput, 
  onSendMessage 
}: {
  messages: Array<{
    id: string
    role: 'system' | 'user' | 'assistant'
    parts: Array<{
      type: string
      text?: string
      input?: unknown
      output?: unknown
    }>
  }>
  status: string
  error: Error | null | undefined
  input: string
  setInput: (value: string) => void
  onSendMessage: () => void
}) {
  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 flex flex-col h-full">
      <div className="px-3 py-2 border-b border-gray-700">
        <h3 className="text-xs font-semibold text-white">AI Assistant</h3>
      </div>
      
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 && (
          <div className="text-xs text-gray-400 italic">
            Ask me about the world, command NPCs, or request information...
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className="space-y-2">
            <div className="text-xs font-semibold text-gray-400">
              {m.role === 'user' ? '👤 You' : '🤖 AI'}
            </div>
            {m.parts.map((part, i: number) => {
              const partKey = `${m.id}-part-${i}-${part.type}`
              if (part.type === 'text' && part.text) {
                return (
                  <div 
                    key={partKey} 
                    className={`text-xs p-2 rounded ${
                      m.role === 'user' 
                        ? 'bg-blue-600 text-white' 
                        : 'bg-gray-700 text-gray-100'
                    }`}
                  >
                    {part.text}
                  </div>
                )
              }
              if (part.type.startsWith('tool-')) {
                const toolName = part.type.replace('tool-', '')
                const hasInput = Object.prototype.hasOwnProperty.call(part, 'input')
                const hasOutput = Object.prototype.hasOwnProperty.call(part, 'output')
                return (
                  <div key={partKey} className="space-y-1">
                    {hasInput && (
                      <div className="text-xs bg-amber-900/30 border border-amber-700 rounded p-2 text-amber-100">
                        <div className="font-semibold">↳ Tool call: {toolName}</div>
                        <pre className="mt-1 whitespace-pre-wrap break-words">{JSON.stringify((part as any).input, null, 2)}</pre>
                      </div>
                    )}
                    {hasOutput && (
                      <div className="text-xs bg-green-900/30 border border-green-700 rounded p-2 text-green-100">
                        <div className="font-semibold">✓ Tool result: {toolName}</div>
                        <pre className="mt-1 whitespace-pre-wrap break-words">{JSON.stringify((part as any).output, null, 2)}</pre>
                      </div>
                    )}
                  </div>
                )
              }
              return null
            })}
          </div>
        ))}
        {status === 'streaming' && (
          <div className="text-xs text-gray-400 italic">AI is thinking...</div>
        )}
      </div>
      
      {error && (
        <div className="mx-4 mb-2 p-2 bg-red-900/30 border border-red-700 rounded text-xs text-red-200">
          Error: {error.message}
        </div>
      )}
      
      <div className="border-t border-gray-700 p-3">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={status !== 'ready' ? 'AI is thinking...' : 'Ask about the world or give commands...'}
            disabled={status !== 'ready'}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (input.trim().length === 0) return
                onSendMessage()
              }
            }}
            className="flex-1 bg-gray-900 text-gray-100 rounded px-3 py-2 text-sm border border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
          <button
            type="button"
            onClick={() => {
              if (input.trim().length === 0) return
              onSendMessage()
            }}
            disabled={status !== 'ready'}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white text-sm px-4 py-2 rounded font-medium"
          >
            Send
          </button>
        </div>
        <div className="mt-2 text-xs text-gray-500">
          Try: "What's in the world?", "Tell Alice to pick up the red mug", "Check Bob's inventory"
        </div>
      </div>
    </div>
  )
}

/* ============================= API KEY INPUT ============================= */

export function ApiKeyInput({ 
  inputKey, 
  setInputKey, 
  onSave 
}: { 
  inputKey: string
  setInputKey: (value: string) => void
  onSave: () => void 
}) {
  return (
    <div style={{ maxWidth: 480, margin: "48px auto", padding: 16 }}>
      <h1 style={{ fontSize: 24, marginBottom: 12 }}>AI World - Enter Google API Key</h1>
      <input
        value={inputKey}
        onChange={(e) => setInputKey(e.target.value)}
        placeholder="AIza..."
        style={{ width: "100%", padding: 8, marginBottom: 12 }}
      />
      <button
        type="button"
        onClick={onSave}
        style={{ padding: "8px 12px" }}
      >
        Save Key
      </button>
    </div>
  )
}

