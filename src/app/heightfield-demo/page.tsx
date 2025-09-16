'use client'

import HeightfieldDemo from '../../components/HeightfieldDemo'

export default function HeightfieldDemoPage() {
  return (
    <div className="min-h-screen bg-gray-900 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Heightfield Physics Demo</h1>
            <p className="text-gray-300">Interactive physics demonstration using React-Three-Rapier's HeightfieldCollider. Objects spawn automatically and fall onto a procedurally generated terrain with realistic physics.</p>
          </div>
          <a href="/heightfield-simple" className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors">View Simple Version</a>
        </div>
        
        <HeightfieldDemo />
        
        <div className="mt-6 grid md:grid-cols-2 gap-6">
          <div className="bg-gray-800 p-6 rounded-lg">
            <h2 className="text-xl font-bold text-white mb-3">Features</h2>
            <ul className="text-gray-300 space-y-2">
              <li>• <strong>Heightfield Collider:</strong> Procedurally generated terrain with accurate physics</li>
              <li>• <strong>Dynamic Objects:</strong> Randomly spawning boxes and spheres</li>
              <li>• <strong>Collision Detection:</strong> Visual feedback for collision events</li>
              <li>• <strong>Realistic Physics:</strong> Powered by Rapier physics engine</li>
              <li>• <strong>Interactive Camera:</strong> Orbit controls for exploring the scene</li>
            </ul>
          </div>
          
          <div className="bg-gray-800 p-6 rounded-lg">
            <h2 className="text-xl font-bold text-white mb-3">Technical Details</h2>
            <ul className="text-gray-300 space-y-2">
              <li>• <strong>Heightfield Size:</strong> 20x20 grid</li>
              <li>• <strong>Terrain Scale:</strong> 10x2x10 units (width×height×depth)</li>
              <li>• <strong>Physics Engine:</strong> Rapier.js via @react-three/rapier</li>
              <li>• <strong>Rendering:</strong> Three.js via @react-three/fiber</li>
              <li>• <strong>Collision Events:</strong> Real-time collision detection and visualization</li>
            </ul>
          </div>
        </div>

        <div className="mt-6 bg-gray-800 p-6 rounded-lg">
          <h2 className="text-xl font-bold text-white mb-3">How It Works</h2>
          <p className="text-gray-300 mb-4">
            The demo creates a heightfield collider from a procedurally generated height array. The terrain is visualized 
            using a Three.js PlaneGeometry with the same height data applied to create a matching visual representation.
          </p>
          <p className="text-gray-300">
            Objects are spawned dynamically and fall under gravity, interacting with the terrain through Rapier's 
            collision detection system. Yellow ring indicators appear at collision points to visualize the physics interactions.
          </p>
        </div>
        
        <div className="mt-6 flex gap-4 flex-wrap">
          <a
            href="/"
            className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
          >
            ← Back to Home
          </a>
          <a
            href="/bunker-rapier"
            className="inline-block bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
          >
            View Bunker Physics Demo
          </a>
          <a
            href="/three"
            className="inline-block bg-purple-600 hover:bg-purple-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
          >
            Basic Three.js Demo
          </a>
        </div>

        <div className="mt-4 text-xs text-gray-500">
          Built with @react-three/fiber and @react-three/rapier. Heightfield collision detection powered by Rapier physics engine.
        </div>
      </div>
    </div>
  )
}
