'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export default function FluidDemoPage() {
  const [status, setStatus] = useState<string>('Idle')
  const [elapsedMs, setElapsedMs] = useState<number | null>(null)
  const [demoRaw, setDemoRaw] = useState<string>('')
  const [actions, setActions] = useState<string[]>([])
  const workerRef = useRef<Worker | null>(null)

  type WorkerResultMessage = {
    type: 'result'
    demo?: string
    actions?: string[]
    steps?: string[]
    elapsedMs?: number
    message?: string
  }
  type WorkerErrorMessage = { type: 'error'; message: string; elapsedMs?: number }

  const runDemo = useCallback(async () => {
    setStatus('Loading WASM and running demo...')
    setElapsedMs(null)
    setDemoRaw('')
    setActions([])

    // Ensure previous worker is terminated before starting a new one
    if (workerRef.current) {
      workerRef.current.terminate()
      workerRef.current = null
    }

    const worker = new Worker('/workers/fluid-htn.worker.js', { type: 'module' })
    workerRef.current = worker

    await new Promise<void>((resolve, reject) => {
      worker.onmessage = (ev: MessageEvent<WorkerResultMessage | WorkerErrorMessage>) => {
        const data = (ev.data || {}) as WorkerResultMessage | WorkerErrorMessage
        if (data.type === 'result') {
          const { demo, actions, elapsedMs, steps } = data as WorkerResultMessage
          // Support both runDemo shape (demo/actions) and plan shapes (steps)
          const act = Array.isArray(actions) ? actions : Array.isArray(steps) ? steps : []
          const demoText = typeof demo === 'string' ? demo : Array.isArray(steps) ? steps.join(',') : ''
          setDemoRaw(demoText)
          setActions(act)
          if (typeof elapsedMs === 'number') setElapsedMs(elapsedMs)
          setStatus('Done')
          worker.terminate()
          workerRef.current = null
          resolve()
        } else if (data.type === 'error') {
          const { message } = data as WorkerErrorMessage
          setStatus('Error')
          console.error('[fluid-demo] worker error', (message as string) || 'Unknown error')
          worker.terminate()
          workerRef.current = null
          reject(new Error((message as string) || 'Unknown error'))
        }
      }
      worker.postMessage({ type: 'runDemo' })
    })
  }, [])

  useEffect(() => {
    runDemo()
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate()
        workerRef.current = null
      }
    }
  }, [runDemo])

  return (
    <div className="min-h-screen bg-gray-900">
      <div className="p-6">
        <h1 className="text-3xl font-bold text-white mb-2">Fluid HTN Demo (RunDemo via Worker)</h1>
        <p className="text-gray-300 mb-4">Status: {status} {elapsedMs != null ? `(elapsed ${elapsedMs} ms)` : ''}</p>

        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 mb-4">
          <div className="flex items-center gap-3 mb-2">
            <button type="button" onClick={runDemo} className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg">Run Demo Again</button>
            <a href="/" className="bg-gray-700 hover:bg-gray-600 text-white font-medium py-2 px-4 rounded-lg">← Back to Home</a>
          </div>
          <div className="text-gray-300">
            <div className="mb-2">
              <span className="opacity-80">Raw result:</span>
              <pre className="mt-1 bg-gray-900 p-3 rounded text-sm whitespace-pre-wrap break-words">{demoRaw || '(waiting...)'}</pre>
            </div>
            <div>
              <span className="opacity-80">Actions:</span>
              {actions.length > 0 ? (
                <ul className="mt-1 list-disc list-inside text-sm">
                  {actions.map((a, i) => (
                    <li key={`${i}_${a}`}>{a}</li>
                  ))}
                </ul>
              ) : (
                <div className="mt-1 text-sm opacity-80">(none yet)</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}


