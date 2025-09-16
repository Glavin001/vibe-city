'use client'

import SimpleHeightfieldDemo from '../../components/SimpleHeightfieldDemo'

export default function SimpleHeightfieldPage() {
  return (
    <div className="min-h-screen bg-gray-900 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Simple Heightfield Demo</h1>
            <p className="text-gray-300">Minimal 3×3 heightfield using (widthQuads, depthQuads) with (w+1)×(d+1) heights.</p>
          </div>
          <a href="/heightfield-demo" className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors">View Complex Version</a>
        </div>

        <SimpleHeightfieldDemo />

        <div className="mt-6 flex gap-4 flex-wrap">
          <a href="/" className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors">← Back to Home</a>
          <a href="/heightfield-demo" className="inline-block bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-4 rounded-lg transition-colors">Complex Heightfield Demo</a>
        </div>
      </div>
    </div>
  )
}


