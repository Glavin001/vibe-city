'use client'

import DynamicHeightfieldDemo from '../../components/DynamicHeightfieldDemo'

export default function DynamicHeightfieldPage() {
  return (
    <div className="min-h-screen bg-gray-900 p-6">
      <div className="mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Dynamic Heightfield Demo</h1>
            <p className="text-gray-300">Animated heightmap with time-varying noise, updating physics periodically.</p>
          </div>
          <a href="/heightfield-demo" className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors">View Static Version</a>
        </div>

        <div className="w-full">
          <DynamicHeightfieldDemo />
        </div>

        <div className="mt-6 flex gap-4 flex-wrap">
          <a href="/" className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors">← Back to Home</a>
          <a href="/heightfield-simple" className="inline-block bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-4 rounded-lg transition-colors">Simple Heightfield Demo</a>
        </div>
      </div>
    </div>
  )
}
