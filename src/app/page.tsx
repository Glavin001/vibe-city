interface Demo {
  href: string;
  icon: string;
  title: string;
  description: string;
}

interface DemoCategory {
  name: string;
  demos: Demo[];
}

const demoCategories: DemoCategory[] = [
  {
    name: "3D Graphics & Rendering",
    demos: [
      {
        href: "/three",
        icon: "🎲",
        title: "THREE.js Demo",
        description: "Basic THREE.js setup with interactive 3D scene. A starting point for 3D web graphics."
      },
      {
        href: "/grass",
        icon: "🌿",
        title: "Grass Demo (V1)",
        description: "First iteration of procedural grass rendering. Features basic wind simulation and LOD optimization."
      },
      {
        href: "/grass-v2",
        icon: "🌱",
        title: "Grass Demo (V2)",
        description: "Enhanced grass rendering with improved shaders. Better performance and more realistic movement."
      },
      {
        href: "/instanced-mesh2",
        icon: "🔲",
        title: "Instanced Mesh2 Demo",
        description: "Advanced instanced mesh rendering for thousands of objects. Demonstrates GPU optimization techniques."
      }
    ]
  },
  {
    name: "Physics & Terrain",
    demos: [
      {
        href: "/three-pinata",
        icon: "🎪",
        title: "THREE.js + Pinata",
        description: "Interactive 3D piñata with physics simulation. Break it open with realistic destruction effects!"
      },
      {
        href: "/heightfield-demo",
        icon: "🏔️",
        title: "Heightfield Physics Demo",
        description: "Interactive terrain with Rapier physics integration. Demonstrates collision detection on height maps."
      },
      {
        href: "/heightfield-dynamic",
        icon: "⛰️",
        title: "Heightfield (Dynamic)",
        description: "Real-time deformable terrain system. Modify the landscape dynamically with physics interactions."
      },
      {
        href: "/heightfield-simple",
        icon: "🗻",
        title: "Heightfield (Simple)",
        description: "Simplified heightfield implementation for learning. Clean code structure for understanding the basics."
      },
      {
        href: "/heightfield-craters",
        icon: "💥",
        title: "Heightfield (Craters)",
        description: "Dynamic crater creation on terrain surfaces. Creates realistic impact deformations with physics."
      },
      {
        href: "/bunker-rapier",
        icon: "⚡",
        title: "Bunker (Rapier Physics)",
        description: "Bunker demo powered by Rapier physics engine. Fast and accurate physics simulation in the browser."
      },
      {
        href: "/destructible-wall",
        icon: "🧱",
        title: "Destructible Wall",
        description: "Breakable wall system with realistic destruction. Uses physics constraints and fracture patterns."
      }
      ,{
        href: "/shockwave-demo",
        icon: "💣",
        title: "Shockwave Demo",
        description: "Interactive explosive shockwave with presets (TNT/C4/etc.) and simple scenes."
      }
    ]
  },
  {
    name: "AI & Game Logic",
    demos: [
      {
        href: "/bunker",
        icon: "🏰",
        title: "Bunker Mission (HTN)",
        description: "AI-driven NPCs using Hierarchical Task Networks. Watch soldiers plan and execute tactical missions."
      },
      {
        href: "/bunker-fluid",
        icon: "💧",
        title: "Bunker (Fluid HTN + WASM)",
        description: "Advanced HTN planning with WASM performance. Fluid HTN allows dynamic replanning during execution."
      },
      {
        href: "/fluid-demo",
        icon: "🧩",
        title: "Fluid HTN Demo",
        description: "Pure demonstration of Fluid HTN planning system. See how AI agents decompose complex tasks."
      }
    ]
  },
  {
    name: "Chat & Conversation",
    demos: [
      {
        href: "/ai-chat",
        icon: "🤖",
        title: "AI Chat",
        description: "Basic AI chat interface with streaming responses. Connect to various LLM providers for conversation."
      },
      {
        href: "/ai-chat-advanced",
        icon: "🧠",
        title: "AI Chat (Advanced)",
        description: "Enhanced chat with advanced features and context. Includes memory and conversation management."
      },
      {
        href: "/npc-chat",
        icon: "🧑‍🚀",
        title: "NPC Chat",
        description: "Interactive NPC conversations with personality. Game-ready dialogue system with character traits."
      }
    ]
  },
  {
    name: "Audio & Speech",
    demos: [
      {
        href: "/whisper",
        icon: "🔊",
        title: "Whisper STT",
        description: "OpenAI Whisper speech-to-text in the browser. High-quality transcription running locally."
      },
      {
        href: "/kokoro-tts",
        icon: "🗣️",
        title: "Kokoro TTS",
        description: "Text-to-speech synthesis using Kokoro model. Natural-sounding voice generation in real-time."
      },
      {
        href: "/vad",
        icon: "🎙️",
        title: "VAD Demo",
        description: "Voice Activity Detection using Silero VAD. Detect when someone is speaking with low latency."
      },
      {
        href: "/voice-to-voice",
        icon: "🎤",
        title: "Voice to Voice",
        description: "Real-time voice conversation system. Combines STT, AI, and TTS for natural dialogue."
      },
      {
        href: "/kokoro-chunker",
        icon: "✂️",
        title: "Kokoro Chunker",
        description: "Smart text chunking for TTS processing. Splits text at natural boundaries for smoother speech."
      }
    ]
  },
  {
    name: "Computer Vision",
    demos: [
      {
        href: "/face-api",
        icon: "😊",
        title: "Face API",
        description: "Real-time face detection and recognition. Track facial features and expressions in the browser."
      }
    ]
  }
];

function DemoCard({ demo }: { demo: Demo }) {
  return (
    <a
      href={demo.href}
      className="group relative overflow-hidden rounded-xl bg-gray-800 p-6 transition-all duration-300 hover:bg-gray-700 hover:shadow-xl hover:shadow-gray-900/50 hover:-translate-y-1"
    >
      <div className="flex items-start gap-4">
        <div className="text-4xl flex-shrink-0 transition-transform duration-300 group-hover:scale-110">
          {demo.icon}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-white text-lg mb-1 group-hover:text-blue-400 transition-colors">
            {demo.title}
          </h3>
          <p className="text-gray-400 text-sm leading-relaxed">
            {demo.description}
          </p>
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-blue-500 to-purple-500 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
    </a>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-900 to-black">
      <div className="container mx-auto px-6 py-12 max-w-7xl">
        <header className="text-center mb-16">
          <h1 className="text-5xl font-bold text-white mb-4 bg-gradient-to-r from-blue-400 to-purple-600 bg-clip-text text-transparent">
            Vibe City Demos
          </h1>
          <p className="text-xl text-gray-400 max-w-2xl mx-auto">
            Explore interactive demos showcasing 3D graphics, physics, AI, and more.
            Built with cutting-edge web technologies.
          </p>
        </header>

        <div className="space-y-12">
          {demoCategories.map((category) => (
            <section key={category.name}>
              <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
                <div className="h-px flex-1 bg-gradient-to-r from-gray-700 to-transparent" />
                {category.name}
                <div className="h-px flex-1 bg-gradient-to-l from-gray-700 to-transparent" />
              </h2>
              <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                {category.demos.map((demo) => (
                  <DemoCard key={demo.href} demo={demo} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
