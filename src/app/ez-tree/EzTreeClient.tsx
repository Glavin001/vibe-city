"use client";

import { useState, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Tree, TreePreset } from "@dgreenheck/ez-tree";

function GeneratedTree({
  preset,
  seed,
  levels,
  leafCount,
}: {
  preset: string;
  seed: number;
  levels: number;
  leafCount: number;
}) {
  const tree = useMemo(() => {
    const t = new Tree();
    t.loadPreset(preset);
    t.options.seed = seed;
    t.options.branch.levels = levels;
    t.options.leaves.count = leafCount;
    t.generate();
    t.castShadow = true;
    t.receiveShadow = true;
    return t;
  }, [preset, seed, levels, leafCount]);

  useFrame((state) => {
    tree.update(state.clock.elapsedTime);
  });

  return <primitive object={tree} />;
}

export default function EzTreePage() {
  const presets = Object.keys(TreePreset);
  const [preset, setPreset] = useState(presets[0]);
  const [seed, setSeed] = useState(12345);
  const [levels, setLevels] = useState(3);
  const [leafCount, setLeafCount] = useState(400);

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <h1 className="text-4xl font-bold mb-4">EZ Tree Demo</h1>
      <div className="flex flex-col md:flex-row gap-8">
        <div className="flex-1 h-[500px] bg-black rounded-lg overflow-hidden">
          <Canvas shadows camera={{ position: [40, 40, 40], fov: 60 }}>
            <ambientLight intensity={0.5} />
            <directionalLight
              position={[50, 100, 50]}
              intensity={1}
              castShadow
            />
            <GeneratedTree
              preset={preset}
              seed={seed}
              levels={levels}
              leafCount={leafCount}
            />
            <OrbitControls />
          </Canvas>
        </div>
        <div className="w-full md:w-80 bg-gray-800 p-4 rounded-lg space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Preset</label>
            <select
              className="w-full bg-gray-700 text-white rounded p-2"
              value={preset}
              onChange={(e) => setPreset(e.target.value)}
            >
              {presets.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              Seed: {seed}
            </label>
            <input
              type="range"
              min="0"
              max="65535"
              value={seed}
              onChange={(e) => setSeed(parseInt(e.target.value))}
              className="w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              Branch Levels: {levels}
            </label>
            <input
              type="range"
              min="0"
              max="3"
              value={levels}
              onChange={(e) => setLevels(parseInt(e.target.value))}
              className="w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              Leaf Count: {leafCount}
            </label>
            <input
              type="range"
              min="0"
              max="1000"
              value={leafCount}
              onChange={(e) => setLeafCount(parseInt(e.target.value))}
              className="w-full"
            />
          </div>
        </div>
      </div>
      <div className="mt-6">
        <a
          href="/"
          className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
        >
          ← Back to Home
        </a>
      </div>
    </div>
  );
}
