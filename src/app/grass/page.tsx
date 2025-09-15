"use client";

import dynamic from "next/dynamic";

const GrassDemo = dynamic(() => import("@/components/GrassDemo"), {
  ssr: false,
});

export default function GrassPage() {
  return (
    <div className="min-h-screen bg-gray-900">
      <div className="p-8">
        <h1 className="text-4xl font-bold text-white mb-4">
          High-Quality Grass
        </h1>
        <p className="text-gray-300 mb-8">
          Instanced, shader-driven grass with wind and interactions.
        </p>
        <div className="w-full h-[600px] bg-black rounded-lg overflow-hidden">
          <GrassDemo />
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
    </div>
  );
}
