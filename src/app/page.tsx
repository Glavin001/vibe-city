export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center font-sans bg-gray-900 p-8">
      <h1 className="text-3xl font-bold text-white mb-8">Welcome</h1>
      <div className="flex flex-col gap-4 w-full max-w-xs">
        <a
          href="/three"
          className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium text-center py-3 px-4 transition-colors"
        >
          🎲 THREE.js Demo
        </a>
        <a
          href="/bunker"
          className="rounded-lg bg-gray-800 hover:bg-gray-700 text-white font-medium text-center py-3 px-4 transition-colors"
        >
          🏰 Bunker Mission (HTN + Three.js)
        </a>
        <a
          href="/bunker-fluid"
          className="rounded-lg bg-gray-800 hover:bg-gray-700 text-white font-medium text-center py-3 px-4 transition-colors"
        >
          💧 Bunker (Fluid HTN + WASM)
        </a>
        <a
          href="/fluid-demo"
          className="rounded-lg bg-gray-800 hover:bg-gray-700 text-white font-medium text-center py-3 px-4 transition-colors"
        >
          ⚡ Fluid HTN Demo
        </a>
      </div>
    </div>
  );
}
