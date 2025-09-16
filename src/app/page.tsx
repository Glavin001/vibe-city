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
          href="/grass"
          className="rounded-lg bg-gray-800 hover:bg-gray-700 text-white font-medium text-center py-3 px-4 transition-colors"
        >
          🌿 Grass Demo
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
        <a
          href="/ai-chat"
          className="rounded-lg bg-gray-800 hover:bg-gray-700 text-white font-medium text-center py-3 px-4 transition-colors"
        >
          🤖 AI Chat
        </a>
        <a
          href="/ai-chat-advanced"
          className="rounded-lg bg-gray-800 hover:bg-gray-700 text-white font-medium text-center py-3 px-4 transition-colors"
        >
          🧠 AI Chat (Advanced)
        </a>
        <a
          href="/npc-chat"
          className="rounded-lg bg-gray-800 hover:bg-gray-700 text-white font-medium text-center py-3 px-4 transition-colors"
        >
          🧑‍🚀 NPC Chat
        </a>
        <a
          href="/face-api"
          className="rounded-lg bg-gray-800 hover:bg-gray-700 text-white font-medium text-center py-3 px-4 transition-colors"
        >
          🙂 Face API
        </a>
        <a
          href="/kokoro-tts"
          className="rounded-lg bg-gray-800 hover:bg-gray-700 text-white font-medium text-center py-3 px-4 transition-colors"
        >
          🗣️ Kokoro TTS
        </a>
        <a
          href="/vad"
          className="rounded-lg bg-gray-800 hover:bg-gray-700 text-white font-medium text-center py-3 px-4 transition-colors"
        >
          🎙️ VAD Demo
        </a>
        <a
          href="/bunker-rapier"
          className="rounded-lg bg-gray-800 hover:bg-gray-700 text-white font-medium text-center py-3 px-4 transition-colors"
        >
          ⚡ Bunker (Rapier Physics)
        </a>
        <a
          href="/heightfield-demo"
          className="rounded-lg bg-green-600 hover:bg-green-700 text-white font-medium text-center py-3 px-4 transition-colors"
        >
          🏔️ Heightfield Physics Demo
        </a>
        <a
          href="/heightfield-dynamic"
          className="rounded-lg bg-green-500 hover:bg-green-600 text-white font-medium text-center py-3 px-4 transition-colors"
        >
          🏔️ Heightfield (Dynamic)
        </a>
        <a
          href="/heightfield-simple"
          className="rounded-lg bg-green-700 hover:bg-green-800 text-white font-medium text-center py-3 px-4 transition-colors"
        >
          🏔️ Heightfield (Simple)
        </a>
        <a
          href="/kokoro-chunker"
          className="rounded-lg bg-gray-800 hover:bg-gray-700 text-white font-medium text-center py-3 px-4 transition-colors"
        >
          ✂️ Kokoro Chunker
        </a>
        <a
          href="/voice-to-voice"
          className="rounded-lg bg-gray-800 hover:bg-gray-700 text-white font-medium text-center py-3 px-4 transition-colors"
        >
          🎤 Voice to Voice
        </a>
        <a
          href="/whisper"
          className="rounded-lg bg-gray-800 hover:bg-gray-700 text-white font-medium text-center py-3 px-4 transition-colors"
        >
          🔊 Whisper STT
        </a>
      </div>
    </div>
  );
}
