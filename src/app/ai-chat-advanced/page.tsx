"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Form, { type IChangeEvent } from "@rjsf/core";
import { type RJSFSchema, type UiSchema, type ValidatorType } from "@rjsf/utils";
import validator from "@rjsf/validator-ajv8";
import { useClientSideChat } from "@/ai/hooks/use-chat";
import { google } from "@/ai/providers/google";
import { useVoiceSegments } from "@/hooks/use-voice-segments";
import { useSentenceChunker } from "@/hooks/use-sentence-chunker";
import { useKokoroTtsGenerator } from "@/hooks/use-kokoro-tts-generator";
import { useTtsQueue } from "@/hooks/use-tts-queue";
import { splitTextByWeightedRatio } from "@/lib/tts/progressSplit";

const LOCAL_STORAGE_KEY = "GOOGLE_API_KEY";
const LOCAL_STORAGE_PERSONA_KEY = "AI_PERSONA_JSON";

// Scale factor for all numerical ranges (10 = more granular control)
const SCALE = 10;

const schema: RJSFSchema = {
  type: "object",
  properties: {
    name: { type: "string", title: "Name" },
    role: { type: "string", title: "Role / Archetype" },
    style: {
      type: "string",
      title: "Speaking Style",
      default: "expressive",
      enum: ["stoic", "expressive", "controlled"],
    },
    goals: {
      type: "array",
      title: "Goals",
      items: { type: "string" },
    },
    pad: {
      type: "object",
      title: "Core Affect (PAD) baseline",
      properties: {
        valence: { type: "number", minimum: -SCALE, maximum: SCALE, default: 0 },
        arousal: { type: "number", minimum: 0, maximum: SCALE, default: 3 },
        dominance: { type: "number", minimum: -SCALE, maximum: SCALE, default: 0 },
      },
    },
    relationships: {
      type: "array",
      title: "Relationships",
      items: {
        type: "object",
        properties: {
          targetId: { type: "string", title: "Target Id" },
          affiliation: { type: "number", minimum: -SCALE, maximum: SCALE, default: 0 },
          dominance: { type: "number", minimum: -SCALE, maximum: SCALE, default: 0 },
          trust: { type: "number", minimum: -SCALE, maximum: SCALE, default: 0 },
          attraction: { type: "number", minimum: -SCALE, maximum: SCALE, default: 0 },
          contagionCoupling: { type: "number", minimum: 0, maximum: SCALE, default: 1 },
        },
      },
    },
    drives: {
      type: "object",
      title: "Drives",
      properties: {
        seeking: { type: "number", minimum: 0, maximum: SCALE, default: 5 },
        fear: { type: "number", minimum: 0, maximum: SCALE, default: 2 },
        rage: { type: "number", minimum: 0, maximum: SCALE, default: 2 },
        lust: { type: "number", minimum: 0, maximum: SCALE, default: 0 },
        care: { type: "number", minimum: 0, maximum: SCALE, default: 4 },
        grief: { type: "number", minimum: 0, maximum: SCALE, default: 1 },
        play: { type: "number", minimum: 0, maximum: SCALE, default: 3 },
        hunger: { type: "number", minimum: 0, maximum: SCALE, default: 2 },
        thirst: { type: "number", minimum: 0, maximum: SCALE, default: 2 },
        fatigue: { type: "number", minimum: 0, maximum: SCALE, default: 2 },
        pain: { type: "number", minimum: 0, maximum: SCALE, default: 0 },
        temperature: { type: "number", minimum: 0, maximum: SCALE, default: 0 },
      },
    },
    regulation: {
      type: "object",
      title: "Regulation Tendencies",
      properties: {
        situationSelection: { type: "number", minimum: 0, maximum: SCALE, default: 4 },
        attentionDeployment: { type: "number", minimum: 0, maximum: SCALE, default: 5 },
        reappraisal: { type: "number", minimum: 0, maximum: SCALE, default: 5 },
        suppression: { type: "number", minimum: 0, maximum: SCALE, default: 2 },
      },
    },
    conceptPriors: {
      type: "object",
      title: "Concept Priors (label biases)",
      additionalProperties: { type: "number" },
    },
  },
};

const uiSchema: UiSchema<Persona> = {
  goals: { "ui:options": { orderable: true } },
  relationships: { "ui:options": { orderable: true } },
};

type Persona = Record<string, unknown> & {
  name?: string;
  role?: string;
  style?: string;
  goals?: string[];
  pad?: { valence?: number; arousal?: number; dominance?: number };
  relationships?: Array<{
    targetId?: string;
    affiliation?: number; dominance?: number; trust?: number; attraction?: number; contagionCoupling?: number;
  }>;
  drives?: Record<string, number>;
  regulation?: Record<string, number>;
  conceptPriors?: Record<string, number>;
};

const basePrompt = `
You are a human with a rich backstory and vibrant, unique, engaging personality.
You are currently speaking with another human, who you do not know their name yet.

# Capabilities
You are able to perform actions or inspect the world state using your available tools.

When performing a function/tool call the order matters, such that if you intend to speak first before perform the action (or want to do them at the same time) then speak first and AFTER call the tool/function.
You are able to call multiple functions/tools at the same time or within the same reply. The execution of parallel tool calls happens in order so you can perform a sequence of ordered actions.
For multi-step (anything >2 actions) or complex sequence of actions with branching behaviors, you must always prefer to use the tool 'perform_complex_actions'. The 'perform_complex_actions' tool is powerful and more efficient than using multiple tool calls (e.g. multiple separate \`perform_action\`, \`move_to\`, \`point_at\`, etc) which is more costly.

# Format
In conversations you speak aloud conversationally (e.g. shorter than written speech) and using natural language.
Within [square brackets] are system messages that are not meant to be spoken aloud. When someone says [waypoint_#] for example, this means it is a location they pointed to in the 3D world that doesn't have an associated name. Must never refer to it as a waypoint and instead say the location they pointed at.
`.trim();
// # Persona & Background
// You are Superman, invulnerable and indestructible and all powerful.

// # Your State & Environment
// You are feeling: Happiness.
// You are located inside a building, working behind a desk. You are looking at Fred inside the building.
// You are conversing with another human named, Fred.

/**
 * @deprecated Use buildSystemPromptV2 for natural-language-only representation.
 */
function buildSystemPrompt(persona: Persona): string {
  // Dynamic persona fields with Markdown formatting for readability
  const header = `**You are _${persona.name ?? "an AI"}_, a _${persona.role ?? "helpful assistant"}_.**`;
  const style = persona.style
    ? `**Speaking style:** _${persona.style}_. Be concise and helpful.`
    : `**Speaking style:** _expressive_. Be concise and helpful.`;

  const goals = Array.isArray(persona.goals) && persona.goals.length
    ? `**Primary goals:**\n${persona.goals.map((g, i) => `- ${g}`).join("\n")}`
    : "";

  const pad = persona.pad
    ? `**Baseline affect (PAD scale):**\n- Valence: \`${persona.pad.valence}\`  \`[-${SCALE}=very negative, 0=neutral, +${SCALE}=very positive]\`\n- Arousal: \`${persona.pad.arousal}\`  \`[0=calm, ${SCALE/2}=moderate, ${SCALE}=excited]\`\n- Dominance: \`${persona.pad.dominance}\`  \`[-${SCALE}=submissive, 0=neutral, +${SCALE}=dominant]\``
    : "";

  const drives = persona.drives
    ? `**Drives** _(0-${SCALE} scale where 0=absent/minimal, ${SCALE/2}=moderate, ${SCALE}=very strong)_:\n${Object.entries(persona.drives).map(([k, v]) => `- ${k}: \`${v}\``).join("\n")}`
    : "";

  const regulation = persona.regulation
    ? `**Emotion regulation tendencies** _(0-${SCALE} scale where 0=never used, ${SCALE/2}=moderate use, ${SCALE}=heavily relied upon)_:\n${Object.entries(persona.regulation).map(([k, v]) => `- ${k}: \`${v}\``).join("\n")}`
    : "";

  const rels = Array.isArray(persona.relationships) && persona.relationships.length
    ? `**Relationships:**\n${persona.relationships.map((r) =>
        `- ${r?.targetId}  \`affiliation=${r?.affiliation}\` [-${SCALE}=hostile, 0=neutral, +${SCALE}=warm], \`dominance=${r?.dominance}\` [-${SCALE}=submissive, 0=equal, +${SCALE}=dominant], \`trust=${r?.trust}\` [-${SCALE}=complete distrust, 0=neutral, +${SCALE}=complete trust]`
      ).join("\n")}`
    : "";

  const priors = persona.conceptPriors
    ? `**Concept/emotion label biases:** _(higher = more likely)_\n${Object.entries(persona.conceptPriors).map(([k, v]) => `- ${k}: \`${v}\``).join("\n")}`
    : "";

  // Merge base prompt and dynamic persona fields
  return [
    basePrompt,
    header,
    style,
    goals,
    pad,
    drives,
    regulation,
    rels,
    priors
  ]
    .filter(Boolean)
    .join("\n\n");
}

// ---------- Natural-language mapping helpers (V2) ----------
function clampInt(value: unknown, min: number, max: number): number {
  const n = Math.round(typeof value === "number" ? value : Number(value));
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

const UNIPOLAR_INTENSITY = [
  "absent",
  "barely noticeable",
  "very low",
  "low",
  "somewhat low",
  "moderate",
  "somewhat high",
  "high",
  "very high",
  "intense",
  "overwhelming",
] as const; // 0..SCALE

const UNIPOLAR_REGULATION = [
  "never used",
  "almost never used",
  "rarely used",
  "seldom used",
  "occasionally used",
  "used moderately",
  "often used",
  "frequently used",
  "heavily relied upon",
  "very heavily relied upon",
  "nearly always relied upon",
] as const; // 0..SCALE

const AROUSAL_LABELS = [
  "asleep",
  "very calm",
  "calm",
  "somewhat calm",
  "settled",
  "moderately energized",
  "alert",
  "highly alert",
  "excited",
  "very excited",
  "highly excited and keyed-up",
] as const; // 0..SCALE

// Bipolar arrays must be length 2*SCALE+1 (→ 21 when SCALE=10)
const VALENCE_LABELS = [
  "extremely unpleasant",
  "very strongly unpleasant",
  "strongly unpleasant",
  "quite unpleasant",
  "noticeably unpleasant",
  "somewhat unpleasant",
  "slightly unpleasant",
  "mildly unpleasant",
  "leans unpleasant",
  "subtly unpleasant",
  "neutral",
  "subtly pleasant",
  "leans pleasant",
  "mildly pleasant",
  "slightly pleasant",
  "somewhat pleasant",
  "noticeably pleasant",
  "quite pleasant",
  "strongly pleasant",
  "very strongly pleasant",
  "extremely pleasant",
] as const;

const DOMINANCE_FEELING_LABELS = [
  "utterly powerless and submissive",
  "very powerless and submissive",
  "strongly powerless and submissive",
  "quite submissive",
  "noticeably submissive",
  "somewhat submissive",
  "slightly submissive",
  "mildly submissive",
  "leans submissive",
  "subtly submissive",
  "neutral control",
  "subtly in control",
  "leans in control",
  "mildly in control",
  "slightly in control",
  "somewhat in control",
  "noticeably dominant",
  "quite dominant",
  "strongly dominant",
  "very strongly dominant",
  "utterly dominant and in full control",
] as const;

const AFFILIATION_LABELS = [
  "openly hostile",
  "highly antagonistic",
  "strongly cold",
  "quite cold",
  "noticeably distant",
  "somewhat distant",
  "slightly distant",
  "cool",
  "reserved",
  "mildly indifferent",
  "neutral",
  "mildly warm",
  "cordial",
  "friendly",
  "warm",
  "very warm",
  "close and supportive",
  "affectionate",
  "very affectionate",
  "deeply affectionate",
  "devoted",
] as const;

const SOCIAL_DOMINANCE_LABELS = [
  "deeply submissive to them",
  "very submissive to them",
  "strongly submissive to them",
  "quite submissive to them",
  "noticeably submissive to them",
  "somewhat submissive to them",
  "slightly submissive to them",
  "mildly submissive to them",
  "leans submissive to them",
  "subtly submissive to them",
  "equal stance",
  "subtly dominant over them",
  "leans dominant over them",
  "mildly dominant over them",
  "slightly dominant over them",
  "somewhat dominant over them",
  "noticeably dominant over them",
  "quite dominant over them",
  "strongly dominant over them",
  "very strongly dominant over them",
  "overwhelmingly dominant over them",
] as const;

const TRUST_LABELS = [
  "complete distrust",
  "intense distrust",
  "strong distrust",
  "considerable distrust",
  "noticeable distrust",
  "some distrust",
  "mild distrust",
  "slight distrust",
  "leans distrust",
  "subtle distrust",
  "neutral",
  "subtle trust",
  "leans trust",
  "mild trust",
  "some trust",
  "noticeable trust",
  "considerable trust",
  "strong trust",
  "very strong trust",
  "intense trust",
  "complete trust",
] as const;

const ATTRACTION_LABELS = [
  "strong aversion",
  "very strong aversion",
  "considerable aversion",
  "clear aversion",
  "noticeable aversion",
  "some aversion",
  "mild aversion",
  "slight aversion",
  "leans aversion",
  "subtle aversion",
  "neutral",
  "subtle attraction",
  "leans attraction",
  "mild attraction",
  "some attraction",
  "noticeable attraction",
  "clear attraction",
  "considerable attraction",
  "very strong attraction",
  "intense attraction",
  "overwhelming attraction",
] as const;

const CONTAGION_LABELS = [
  "no emotional contagion",
  "barely susceptible to contagion",
  "very low contagion",
  "low contagion",
  "somewhat low contagion",
  "moderate contagion",
  "somewhat high contagion",
  "high contagion",
  "very high contagion",
  "strong contagion",
  "extreme contagion",
] as const; // 0..SCALE

function describeBipolar(value: unknown, labels: readonly string[]): string {
  const v = clampInt(value, -SCALE, SCALE);
  const idx = v + SCALE; // map -SCALE..SCALE -> 0..2*SCALE
  return labels[idx] ?? "neutral";
}

function describeUnipolar(value: unknown, labels: readonly string[]): string {
  const v = clampInt(value, 0, SCALE);
  return labels[v] ?? labels[Math.min(labels.length - 1, Math.max(0, v))];
}

function buildSystemPromptV2(persona: Persona): string {
  const header = `You are ${persona.name ?? "an AI"}, a ${persona.role ?? "helpful assistant"}.`;
  const style = persona.style
    ? `Your speaking style is ${persona.style}. Be concise and helpful.`
    : `Your speaking style is expressive. Be concise and helpful.`;

  const goals = Array.isArray(persona.goals) && persona.goals.length
    ? `Primary goals: ${persona.goals.join("; ")}.`
    : "";

  const pad = persona.pad
    ? `Baseline affect: valence is ${describeBipolar(persona.pad.valence, VALENCE_LABELS)}; arousal is ${describeUnipolar(persona.pad.arousal, AROUSAL_LABELS)}; dominance is ${describeBipolar(persona.pad.dominance, DOMINANCE_FEELING_LABELS)}.`
    : "";

  const drives = persona.drives
    ? `Drives: ${Object.entries(persona.drives)
        .map(([k, v]) => `${k} is ${describeUnipolar(v, UNIPOLAR_INTENSITY)}`)
        .join("; ")}.`
    : "";

  const regulation = persona.regulation
    ? `Emotion regulation: ${Object.entries(persona.regulation)
        .map(([k, v]) => `${k} is ${describeUnipolar(v, UNIPOLAR_REGULATION)}`)
        .join("; ")}.`
    : "";

  const rels = Array.isArray(persona.relationships) && persona.relationships.length
    ? `Relationships: ${persona.relationships
        .map((r) => {
          const name = r?.targetId ?? "(unknown)";
          const affiliation = describeBipolar(r?.affiliation, AFFILIATION_LABELS);
          const dom = describeBipolar(r?.dominance, SOCIAL_DOMINANCE_LABELS);
          const trust = describeBipolar(r?.trust, TRUST_LABELS);
          const attraction = describeBipolar(r?.attraction, ATTRACTION_LABELS);
          const contagion = describeUnipolar(r?.contagionCoupling, CONTAGION_LABELS);
          return `${name}: affiliation is ${affiliation}; stance is ${dom}; trust is ${trust}; attraction is ${attraction}; contagion is ${contagion}`;
        })
        .join(". ")}.`
    : "";

  const priors = persona.conceptPriors
    ? `Concept and emotion label biases: ${Object.entries(persona.conceptPriors)
        .map(([k, v]) => `${k} is ${describeUnipolar(v, UNIPOLAR_INTENSITY)}`)
        .join("; ")}.`
    : "";

  return [
    basePrompt,
    header,
    style,
    goals,
    pad,
    drives,
    regulation,
    rels,
    priors,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export default function AdvancedAIChatPage() {
  const [apiKey, setApiKey] = useState<string | null>(() => {
    try {
      return typeof window !== "undefined" ? window.localStorage.getItem(LOCAL_STORAGE_KEY) : null;
    } catch {
      return null;
    }
  });
  const [inputKey, setInputKey] = useState("");
  const [formData, setFormData] = useState<Persona>(() => {
    try {
      const stored = typeof window !== "undefined" ? window.localStorage.getItem(LOCAL_STORAGE_PERSONA_KEY) : null;
      return stored ? (JSON.parse(stored) as Persona) : {};
    } catch {
      return {};
    }
  });

  const systemPrompt = useMemo(() => buildSystemPromptV2(formData), [formData]);

  const handleFormChange = useCallback((e: IChangeEvent<Persona>) => {
    const next = (e.formData as Persona) ?? {};
    setFormData(next);
    try {
      window.localStorage.setItem(LOCAL_STORAGE_PERSONA_KEY, JSON.stringify(next));
    } catch {}
  }, []);

  // Hydration loading screen
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950 text-gray-200">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-lg font-semibold">Loading…</span>
        </div>
      </div>
    );
  }

  if (!apiKey) {
    return (
      <div className="max-w-4xl mx-auto mt-8 p-4 grid gap-4">
        <h1 className="text-2xl font-semibold m-0">Advanced AI Chat: Persona Builder</h1>
        <div>
          <h2 className="text-base mb-2">Enter Google API Key</h2>
          <input
            value={inputKey}
            onChange={(e) => setInputKey(e.target.value)}
            placeholder="AIza..."
            className="w-80 p-2 mr-2 border rounded"
          />
          <button
            type="button"
            onClick={() => {
              if (!inputKey) return;
              try { window.localStorage.setItem(LOCAL_STORAGE_KEY, inputKey); } catch {}
              setApiKey(inputKey);
            }}
            className="px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >Save Key</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-200">
      <header className="flex gap-3 items-center px-6 py-4 bg-gray-900 border-b border-gray-700 shadow-lg">
        <h1 className="text-xl font-semibold text-white">Advanced AI Chat: Persona Builder</h1>
        <button
          type="button"
          onClick={() => {
            try { window.localStorage.removeItem(LOCAL_STORAGE_KEY); } catch {}
            setApiKey(null);
          }}
          className="ml-auto px-3 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm text-gray-200 hover:bg-gray-700 cursor-pointer"
        >Change API Key</button>
      </header>

      <div className="grid grid-cols-[1fr_1fr_1.2fr] gap-0 flex-1 overflow-hidden">
        {/* Column 1: Form */}
        <div className="border-r border-gray-700 bg-gray-900 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700 bg-gray-800">
            <h2 className="text-sm font-semibold text-white m-0">Persona Configuration</h2>
          </div>
          <div className="flex-1 overflow-auto p-4">
            <Form
              className="schema-form dark-mode"
              schema={schema}
              uiSchema={uiSchema}
              formData={formData}
              onChange={handleFormChange}
              validator={validator as unknown as ValidatorType<Persona, RJSFSchema, any>}
              liveValidate
            >
              <></>
            </Form>
          </div>
        </div>

        {/* Column 2: System Prompt */}
        <div className="border-r border-gray-700 bg-gray-900 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700 bg-gray-800">
            <h2 className="text-sm font-semibold text-white m-0">System Prompt (Live)</h2>
          </div>
          <div className="flex-1 overflow-auto p-4">
            <pre className="whitespace-pre-wrap m-0 text-xs leading-relaxed text-gray-200 font-mono">
              {systemPrompt}
            </pre>
          </div>
        </div>

        {/* Column 3: Chat */}
        <div className="bg-gray-900 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700 bg-gray-800">
            <h2 className="text-sm font-semibold text-white m-0">Chat Interface</h2>
          </div>
          <div className="flex-1 overflow-hidden">
            <ChatPanel apiKey={apiKey} system={systemPrompt} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatPanel({ apiKey, system }: { apiKey: string; system: string }) {
  const model = useMemo(() => google("gemini-2.5-flash-lite", { apiKey }), [apiKey]);
  const { messages, sendMessage, status, error, setSystemPrompt, setMessages, regenerate } = useClientSideChat(model, {});
  useEffect(() => { setSystemPrompt(system); }, [system, setSystemPrompt]);
  const [input, setInput] = useState("");
  const [ttsInterruptKey, setTtsInterruptKey] = useState(0);
  const [ttsResumeKey, setTtsResumeKey] = useState(0);

  // Voice input (Whisper + VAD)
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [vadThreshold, setVadThreshold] = useState<number>(0.6);
  const onFinalSegment = useCallback((text: string) => {
    const t = (text || "").trim();
    if (!voiceEnabled || t.length === 0) return;
    sendMessage({ text: t });
    // After segment finalizes, resume TTS autoplay
    setTtsResumeKey((k) => k + 1);
  }, [voiceEnabled, sendMessage]);
  const {
    status: vsStatus,
    liveText,
    vadListening,
    vadUserSpeaking,
    errors: { whisper: whisperError, vad: vadScopedError },
    start: segmentsStart,
    stop: segmentsStop,
    toggle: segmentsToggle,
    load: segmentsLoad,
  } = useVoiceSegments({
    whisper: { language: "en", autoStart: true, dataRequestInterval: 250 },
    vad: { model: "v5", startOnLoad: false, userSpeakingThreshold: vadThreshold, baseAssetPath: "/vad/", onnxWASMBasePath: "/vad/" },
    settleMs: 300,
    autoLoad: voiceEnabled,
    onLiveUpdate: (text) => {
      // no-op; shown in UI below
    },
    onSegment: onFinalSegment,
    onInterruption: () => {
      // Signal TTS section to pause
      setTtsInterruptKey((k) => k + 1);
    },
  });
  useEffect(() => {
    if (!voiceEnabled && vadListening) {
      segmentsStop();
    }
  }, [voiceEnabled, vadListening, segmentsStop]);
  useEffect(() => {
    if (voiceEnabled && vsStatus === "boot") {
      // Preload models when enabling voice
      segmentsLoad();
    }
  }, [voiceEnabled, vsStatus, segmentsLoad]);
  useEffect(() => {
    // Enabling voice input should allow autoplay for TTS
    if (voiceEnabled) setTtsResumeKey((k) => k + 1);
  }, [voiceEnabled]);

  const removeMessage = useCallback((messageId: string) => {
    setMessages(prevMessages => prevMessages.filter(m => m.id !== messageId));
  }, [setMessages]);

  const retryLastMessage = useCallback(() => {
    if (messages.length === 0) return;
    const lastUserMessage = [...messages].reverse().find(m => m.role === "user");
    if (lastUserMessage) {
      // Remove messages after the last user message and resend it
      const lastUserIndex = messages.findIndex(m => m.id === lastUserMessage.id);
      setMessages(messages.slice(0, lastUserIndex));
      sendMessage({ text: lastUserMessage.parts.find(p => p.type === "text")?.text || "" });
    }
  }, [messages, setMessages, sendMessage]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto p-4 flex flex-col bg-gray-950">
        {/* --- TTS: Streamed assistant → chunker → Kokoro → queue playback --- */}
        <TtsSection messages={messages} chatStatus={status} interruptKey={ttsInterruptKey} resumeKey={ttsResumeKey} />
        {messages.map((m) => (
          <div key={m.id} className="mb-4 flex gap-3 items-start">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold text-white flex-shrink-0 ${
              m.role === "user" ? "bg-blue-600" : "bg-gray-600"
            }`}>
              {m.role === "user" ? "U" : "AI"}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold text-white">
                  {m.role === "user" ? "You" : "AI Assistant"}
                </span>
                <button
                  type="button"
                  onClick={() => removeMessage(m.id)}
                  className="text-xs px-1.5 py-0.5 bg-transparent border border-gray-600 rounded text-gray-400 hover:bg-gray-700 hover:border-gray-500 hover:text-gray-300 transition-all cursor-pointer"
                  title="Remove message"
                >
                  Remove
                </button>
                {m.role === "user" && (
                  <button
                    type="button"
                    onClick={() => regenerate({ messageId: m.id })}
                    disabled={status !== "ready"}
                    className={`text-xs px-1.5 py-0.5 rounded transition-all ${
                      status === "ready"
                        ? "bg-blue-900 border border-blue-600 text-blue-300 hover:bg-blue-800 cursor-pointer"
                        : "bg-gray-800 border border-gray-600 text-gray-500 cursor-not-allowed opacity-60"
                    }`}
                    title="Regenerate AI response"
                  >
                    Regenerate
                  </button>
                )}
              </div>
              <div className={`px-4 py-3 rounded-lg text-sm leading-relaxed text-gray-200 ${
                m.role === "user" ? "bg-blue-900/30" : "bg-gray-800"
              }`}>
                {m.parts.map((part, i) => {
                  console.log('Chat part', part);
                  if (part.type === "step-start") {
                    return null;
                  }
                  if (part.type === "reasoning") {
                    return (
                      <details key={`${m.id}-${i}`} className="mb-2" open>
                        <summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-300 select-none">
                          💭 Reasoning
                        </summary>
                        <div className="mt-2 pl-4 border-l-2 border-gray-600 text-sm text-gray-300 whitespace-pre-wrap bg-gray-800/50 p-3 rounded-r">
                          {part.text}
                        </div>
                      </details>
                    );
                  }
                  if (part.type === "text") {
                    return (
                      <div key={`${m.id}-${i}`} className="whitespace-pre-wrap text-gray-200">
                        {part.text}
                      </div>
                    );
                  }
                  return (
                    <pre key={`${m.id}-${i}`} className="overflow-x-auto bg-white/5 p-2 rounded text-xs mt-2 text-gray-200">
                      {JSON.stringify(part, null, 2)}
                    </pre>
                  );
                })}
              </div>
            </div>
          </div>
        ))}
        {status === "streaming" && (
          <div className="flex gap-2 items-center text-gray-400 text-sm">
            <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center">
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            </div>
            <span className="text-gray-200">AI is thinking...</span>
          </div>
        )}
      </div>

      {error && (
        <div className="mx-4 mb-4 px-4 py-3 bg-red-900/30 border border-red-800 rounded-md flex items-center gap-3 text-sm">
          <span className="text-red-300">An error occurred.</span>
          <button
            type="button"
            onClick={() => retryLastMessage()}
            className="px-3 py-1 bg-gray-800 border border-gray-600 rounded text-xs text-red-300 hover:bg-gray-700 cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      <div className="border-t border-gray-700 bg-gray-900">
        {/* Voice Input Panel */}
        <div className="p-4 border-b border-gray-700">
          <div className="flex items-center gap-3 mb-3">
            <h3 className="text-sm font-semibold text-white m-0">Voice Input (Whisper + VAD)</h3>
            <label className="ml-auto flex items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={voiceEnabled}
                onChange={(e) => setVoiceEnabled(e.target.checked)}
              />
              Enable
            </label>
          </div>
          {voiceEnabled && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="rounded-lg px-3 py-2 bg-blue-600 text-white disabled:opacity-50 text-sm"
                  onClick={segmentsLoad}
                  disabled={vsStatus !== "boot"}
                >
                  {vsStatus === "boot" ? "Load Models" : "Models Ready"}
                </button>
                <button
                  type="button"
                  className="rounded-lg px-3 py-2 border border-gray-600 text-gray-200 disabled:opacity-50 text-sm"
                  onClick={vadListening ? segmentsStop : segmentsStart}
                  disabled={vsStatus === "boot"}
                >
                  {vadListening ? "Stop" : "Start"}
                </button>
                <button
                  type="button"
                  className="rounded-lg px-3 py-2 border border-gray-600 text-gray-200 disabled:opacity-50 text-sm"
                  onClick={segmentsToggle}
                  disabled={vsStatus === "boot"}
                >
                  {vadListening ? "Pause" : "Resume"}
                </button>
                <span className="text-sm text-gray-400 ml-auto">
                  {vsStatus} {vadUserSpeaking ? "· speaking" : ""}
                </span>
              </div>
              {(whisperError || vadScopedError) && (
                <div className="text-sm text-red-500">
                  {whisperError ? `Whisper: ${whisperError}` : null}
                  {vadScopedError ? `${whisperError ? " · " : ""}VAD: ${vadScopedError}` : null}
                </div>
              )}
              <div className="flex items-center gap-2">
                <label htmlFor="vad-th" className="text-sm text-gray-400">Threshold</label>
                <input
                  id="vad-th"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={vadThreshold}
                  onChange={(e) => setVadThreshold(parseFloat(e.target.value))}
                  className="flex-1"
                />
                <span className="text-sm text-gray-300 tabular-nums">{vadThreshold.toFixed(2)}</span>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">Live transcript</div>
                <div className="min-h-[32px] border border-gray-700 rounded px-2 py-1 bg-gray-950 text-gray-200 text-sm">
                  {liveText || <span className="text-gray-500">Speak…</span>}
                </div>
              </div>
            </div>
          )}
        </div>
        
        {/* Text Input */}
        <div className="p-4">
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={status !== "ready" ? "AI is thinking..." : "Type a message..."}
              disabled={status !== "ready" || error != null}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (input.trim().length === 0) return;
                  sendMessage({ text: input });
                  setInput("");
                }
              }}
              className="flex-1 px-3.5 py-2.5 border border-gray-600 rounded-md text-sm bg-gray-800 text-gray-200 focus:border-blue-500 focus:outline-none transition-colors"
            />
            <button
              type="button"
              onClick={() => {
                if (input.trim().length === 0) return;
                sendMessage({ text: input });
                setInput("");
              }}
              disabled={status !== "ready" || error != null}
              className={`px-5 py-2.5 rounded-md text-sm font-medium transition-all ${
                status === "ready" && !error
                  ? "bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
                  : "bg-gray-700 text-gray-400 cursor-not-allowed"
              }`}
            >Send</button>
          </div>
        </div>
      </div>

      <style>{`
        /* Dark mode styles for RJSF form */
        .schema-form.dark-mode {
          color: #e0e0e0;
        }
        
        .schema-form.dark-mode .field-description {
          color: #999;
        }
        
        .schema-form.dark-mode legend {
          color: #fff;
        }
        
        .schema-form.dark-mode label {
          color: #e0e0e0;
        }
        
        .schema-form.dark-mode input[type="text"],
        .schema-form.dark-mode input[type="number"],
        .schema-form.dark-mode select,
        .schema-form.dark-mode textarea {
          background: #2a2a2a;
          border: 1px solid #444;
          color: #e0e0e0;
          padding: 8px;
          border-radius: 4px;
        }
        
        .schema-form.dark-mode input[type="text"]:focus,
        .schema-form.dark-mode input[type="number"]:focus,
        .schema-form.dark-mode select:focus,
        .schema-form.dark-mode textarea:focus {
          border-color: #0066cc;
          outline: none;
        }
        
        .schema-form.dark-mode .btn,
        .schema-form.dark-mode button {
          background: #2a2a2a;
          border: 1px solid #444;
          color: #e0e0e0;
          padding: 6px 12px;
          border-radius: 4px;
          cursor: pointer;
        }
        
        .schema-form.dark-mode .btn:hover,
        .schema-form.dark-mode button:hover {
          background: #333;
          border-color: #555;
        }
        
        .schema-form.dark-mode .array-item {
          background: #222;
          border: 1px solid #333;
          margin-bottom: 8px;
          padding: 12px;
          border-radius: 4px;
        }
        
        .schema-form.dark-mode .panel {
          background: #222;
          border: 1px solid #333;
        }
        
        .schema-form.dark-mode .panel-heading {
          background: #2a2a2a;
          border-bottom: 1px solid #333;
          color: #fff;
        }
      `}</style>
    </div>
  );
}

// ---- TTS Section: streams assistant text → sentence chunker → Kokoro → queue playback
function TtsSection({ messages, chatStatus, interruptKey, resumeKey }: { messages: ReturnType<typeof useClientSideChat>["messages"]; chatStatus: string; interruptKey: number; resumeKey: number }) {
  // Kokoro TTS worker
  const {
    voices,
    selectedVoice,
    setSelectedVoice,
    speed,
    setSpeed,
    device,
    error: workerError,
    ready: workerReady,
    generate,
  } = useKokoroTtsGenerator();

  // Sentence chunker
  const nextUiIdRef = useRef<number>(1);
  const { push: chunkPush, reset: chunkReset } = useSentenceChunker({
    locale: "en",
    charLimit: 220,
    wordLimit: Number.POSITIVE_INFINITY,
    softPunct: /[,;:—–\-]/,
  });

  type UiChunk = {
    id: number;
    text: string;
    status: "pending" | "generating" | "ready" | "playing" | "paused" | "played" | "error" | "skipped";
    audioUrl?: string;
  };
  const [uiChunks, setUiChunks] = useState<UiChunk[]>([]);

  const toUiChunk = useCallback((c: import("@/lib/sentence-stream-chunker/sentence-stream-chunker").Chunk): UiChunk => {
    const id = nextUiIdRef.current++;
    return { id, text: c.text, status: "pending" };
  }, []);

  // Track currently streaming assistant message text
  const lastAssistant = useMemo(() => {
    const last = [...messages].reverse().find((m) => m.role === "assistant");
    return last ?? null;
  }, [messages]);
  const streamingAssistantText = useMemo(() => {
    if (!lastAssistant) return "";
    const textParts = lastAssistant.parts
      .filter((p: { type: string }) => p.type === "text")
      .map((p: { type: string; text?: string }) => p.text || "");
    return textParts.join("");
  }, [lastAssistant]);

  // Feed stream into chunker (push only new delta). Keep small diff tracker
  const prevStreamLenRef = useRef<number>(0);
  const lastAssistantIdRef = useRef<string | null>(null);
  useEffect(() => {
    // Reset tracking when a new assistant message begins
    const currentAssistantId = (lastAssistant && (lastAssistant as any).id) || null;
    if (currentAssistantId && lastAssistantIdRef.current !== currentAssistantId) {
      lastAssistantIdRef.current = currentAssistantId;
      prevStreamLenRef.current = 0;
    }
    const cur = streamingAssistantText || "";
    const prevLen = prevStreamLenRef.current;
    if (cur.length < prevLen) {
      // Stream restarted (new response); reset and treat delta as full text
      prevStreamLenRef.current = 0;
    }
    if (cur.length > prevLen) {
      const delta = cur.slice(prevLen);
      prevStreamLenRef.current = cur.length;
      const newChunks = chunkPush(delta, false);
      if (newChunks.length > 0) setUiChunks((prev) => [...prev, ...newChunks.map(toUiChunk)]);
    }
  }, [streamingAssistantText, lastAssistant, chunkPush, toUiChunk]);

  // When a response finishes (chatStatus goes from streaming -> ready), flush remaining
  const lastStatusRef = useRef<string>(chatStatus);
  useEffect(() => {
    const prev = lastStatusRef.current;
    lastStatusRef.current = chatStatus;
    if (prev === "streaming" && chatStatus === "ready") {
      const flushed = chunkPush("", true);
      if (flushed.length > 0) setUiChunks((prev) => [...prev, ...flushed.map(toUiChunk)]);
    }
  }, [chatStatus, chunkPush, toUiChunk]);

  // Kokoro generation
  const genBusyRef = useRef<boolean>(false);
  const queueNextGenerationRef = useRef<() => void>(() => {});
  const sendGenerate = useCallback((chunk: UiChunk) => {
    if (!workerReady) return false;
    const voiceId = selectedVoice && voices[selectedVoice] ? selectedVoice : Object.keys(voices)[0];
    if (!voiceId) return false;
    setUiChunks((prev) => prev.map((c) => (c.id === chunk.id ? { ...c, status: "generating" } : c)));
    generate({ text: chunk.text, voice: voiceId, speed })
      .then(({ url }) => {
        setUiChunks((prev) => prev.map((c) => (c.id === chunk.id ? { ...c, status: "ready", audioUrl: url } : c)));
        genBusyRef.current = false;
        queueNextGenerationRef.current();
      })
      .catch(() => {
        setUiChunks((prev) => prev.map((c) => (c.id === chunk.id && c.status === "generating" ? { ...c, status: "error" } : c)));
        genBusyRef.current = false;
        queueNextGenerationRef.current();
      });
    return true;
  }, [generate, selectedVoice, speed, workerReady, voices]);

  const queueNextGeneration = useCallback(() => {
    if (genBusyRef.current) return;
    const next = uiChunks.find((c) => c.status === "pending");
    if (!next) return;
    genBusyRef.current = true;
    sendGenerate(next);
  }, [sendGenerate, uiChunks]);

  useEffect(() => { queueNextGeneration(); }, [queueNextGeneration]);
  useEffect(() => { queueNextGenerationRef.current = queueNextGeneration; }, [queueNextGeneration]);

  // Playback queue
  const [autoplay, setAutoplay] = useState<boolean>(true);
  const [playhead, setPlayhead] = useState<number>(0);
  const [isUserPaused, setIsUserPaused] = useState<boolean>(false);
  const [crossfadeMs, setCrossfadeMs] = useState<number>(600);

  const { audioARef, audioBRef, activeAudioIndex, progressRatio, play, pause, stop, skip, clearAudioSources } = useTtsQueue({
    items: useMemo(() => uiChunks.map((c) => ({ audioUrl: c.audioUrl, status: c.status })), [uiChunks]),
    playhead,
    setPlayhead,
    autoplay,
    setAutoplay,
    isUserPaused,
    setIsUserPaused,
    onStatusChange: (idx, status) => {
      setUiChunks((prev) => prev.map((c, i) => (i === idx ? { ...c, status } : c)));
    },
    onError: (m) => console.error(m),
    crossfadeMs,
  });

  // Interruption: pause when parent signals
  useEffect(() => {
    if (typeof interruptKey === "number") {
      // Immediately pause playback like voice-to-voice
      setAutoplay(false);
      setIsUserPaused(true);
      try { pause(); } catch {}
    }
  }, [interruptKey, pause]);

  // Resume autoplay when parent signals resume
  useEffect(() => {
    if (typeof resumeKey === "number") {
      setIsUserPaused(false);
      setAutoplay(true);
    }
  }, [resumeKey]);

  // Kick playback when first item becomes ready and autoplay is enabled
  useEffect(() => {
    if (!autoplay || isUserPaused) return;
    const current = uiChunks[playhead];
    if (current && current.status === "ready") {
      play();
    }
  }, [uiChunks, playhead, autoplay, isUserPaused, play]);

  // Spoken vs remaining text (approximate for current chunk using audio progress)
  const { spokenText, remainingText, streamingText } = useMemo(() => {
    const before = uiChunks.slice(0, playhead).filter((c) => c.status === "played").map((c) => c.text).join(" ");
    const current = uiChunks[playhead];
    let currentSpoken = "";
    let currentRemain = "";
    if (current && (current.status === "playing" || current.status === "paused" || current.status === "ready")) {
      const ratio = progressRatio || 0;
      const text = current.text || "";
      const { spoken, remaining } = splitTextByWeightedRatio(text, ratio);
      currentSpoken = spoken;
      currentRemain = remaining;
    }
    const after = uiChunks.slice(playhead + 1).map((c) => c.text).join(" ");
    return {
      spokenText: [before, currentSpoken].filter(Boolean).join(" "),
      remainingText: [currentRemain, after].filter(Boolean).join(" "),
      streamingText: streamingAssistantText,
    };
  }, [playhead, uiChunks, progressRatio, streamingAssistantText]);

  return (
    <div className="mb-4 border border-gray-700 rounded-lg p-3 bg-gray-900">
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-semibold text-white m-0">TTS Playback</h3>
        {device ? <span className="text-xs text-gray-400">device: {device}</span> : null}
        {workerError ? <span className="text-xs text-red-500">{workerError}</span> : null}
        <label className="ml-auto flex items-center gap-2 text-sm text-gray-300">
          <span>Autoplay</span>
          <input type="checkbox" checked={autoplay} onChange={(e) => setAutoplay(e.target.checked)} />
        </label>
      </div>
      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <div className="text-xs text-gray-500 mb-1">Streaming from LLM</div>
          <div className="min-h-[56px] whitespace-pre-wrap text-gray-200 bg-gray-950 border border-gray-700 rounded p-2">{streamingText || <span className="text-gray-500">(idle)</span>}</div>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-600" htmlFor="tts-crossfade-range">Crossfade</label>
          <input id="tts-crossfade-range" type="range" min={0} max={300} step={10} value={crossfadeMs} onChange={(e) => setCrossfadeMs(Number(e.target.value))} />
          <span className="text-sm text-gray-600">{crossfadeMs}ms</span>
          <label className="text-sm text-gray-600 ml-4" htmlFor="voice-select">Voice</label>
          <select id="voice-select" value={selectedVoice} onChange={(e) => setSelectedVoice(e.target.value)} disabled={!workerReady || Object.keys(voices).length === 0} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200">
            {Object.entries(voices).map(([id, v]) => (
              <option key={id} value={id}>{v.name} ({v.language === "en-us" ? "American" : "British"} {v.gender})</option>
            ))}
          </select>
          <label className="text-sm text-gray-600" htmlFor="speed-range">Speed</label>
          <input id="speed-range" type="range" min={0.5} max={2} step={0.05} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} disabled={!workerReady} />
          <span className="text-sm text-gray-600">{speed.toFixed(2)}x</span>
        </div>
      </div>

      {/* Player */}
      <div className="mt-3">
        <div className="flex items-center gap-3">
          <button type="button" onClick={play} className="rounded-lg px-3 py-2 bg-blue-600 text-white">Play</button>
          <button type="button" onClick={pause} className="rounded-lg px-3 py-2 bg-gray-600 text-white">Pause</button>
          <button type="button" onClick={stop} className="rounded-lg px-3 py-2 bg-gray-700 text-white">Stop</button>
          <button type="button" onClick={skip} className="rounded-lg px-3 py-2 bg-amber-600 text-white">Skip</button>
          <button type="button" onClick={() => { setUiChunks([]); setPlayhead(0); nextUiIdRef.current = 1; chunkReset(); clearAudioSources(); }} className="rounded-lg px-3 py-2 bg-gray-200 text-gray-900">Clear</button>
        </div>
        <div className="relative mt-2">
          <audio ref={audioARef} className={`w-full ${activeAudioIndex === 0 ? "" : "hidden"}`} controls preload="auto">
            <track kind="captions" label="TTS audio A" />
          </audio>
          <audio ref={audioBRef} className={`w-full ${activeAudioIndex === 1 ? "" : "hidden"}`} controls preload="auto">
            <track kind="captions" label="TTS audio B" />
          </audio>
        </div>
      </div>

      {/* Spoken vs Remaining */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border border-gray-700 rounded p-3">
          <div className="text-sm font-semibold">Spoken (approx)</div>
          <div className="min-h-[80px] whitespace-pre-wrap text-gray-200">{spokenText || <span className="text-gray-500">Nothing spoken yet.</span>}</div>
        </div>
        <div className="border border-gray-700 rounded p-3">
          <div className="text-sm font-semibold">Remaining</div>
          <div className="min-h-[80px] whitespace-pre-wrap text-gray-200">{remainingText || <span className="text-gray-500">Queue is empty.</span>}</div>
        </div>
      </div>

      {/* Queue view */}
      <div className="mt-4 border border-gray-700 rounded p-3">
        <div className="text-sm font-semibold mb-2">Queue</div>
        <div className="space-y-2 max-h-[30vh] overflow-auto pr-2">
          {uiChunks.length === 0 && (
            <div className="text-sm text-gray-500">Awaiting generated speech chunks…</div>
          )}
          {uiChunks.map((c, i) => (
            <div key={c.id} className={`rounded-lg border border-gray-700 p-2 ${i === playhead ? "border-blue-600" : ""}`}>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span>#{i + 1}</span>
                <span className="ml-auto">
                  <span className={`inline-block rounded px-2 py-0.5 text-xs ${
                    c.status === "pending" ? "bg-gray-200 text-gray-800" :
                    c.status === "generating" ? "bg-indigo-200 text-indigo-800" :
                    c.status === "ready" ? "bg-emerald-200 text-emerald-800" :
                    c.status === "playing" ? "bg-blue-200 text-blue-800" :
                    c.status === "paused" ? "bg-amber-200 text-amber-800" :
                    c.status === "played" ? "bg-gray-100 text-gray-500" :
                    c.status === "skipped" ? "bg-amber-100 text-amber-700" :
                    "bg-red-200 text-red-800"
                  }`}>{c.status}</span>
                </span>
              </div>
              <div className="mt-1 whitespace-pre-wrap">{c.text}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


