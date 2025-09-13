"use client";

import { useEffect, useMemo, useState } from "react";
import { useChat } from "@/ai/hooks/use-chat";
import { google } from "@/ai/providers/google";

const LOCAL_STORAGE_KEY = "GOOGLE_API_KEY";

export default function AIChatPage() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [inputKey, setInputKey] = useState("");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(LOCAL_STORAGE_KEY);
      if (stored) setApiKey(stored);
    } catch {}
  }, []);

  if (!apiKey) {
    return (
      <div style={{ maxWidth: 480, margin: "48px auto", padding: 16 }}>
        <h1 style={{ fontSize: 24, marginBottom: 12 }}>Enter Google API Key</h1>
        <input
          value={inputKey}
          onChange={(e) => setInputKey(e.target.value)}
          placeholder="AIza..."
          style={{ width: "100%", padding: 8, marginBottom: 12 }}
        />
        <button
          type="button"
          onClick={() => {
            if (!inputKey) return;
            try {
              window.localStorage.setItem(LOCAL_STORAGE_KEY, inputKey);
              setApiKey(inputKey);
            } catch {}
          }}
          style={{ padding: "8px 12px" }}
        >
          Save Key
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720, margin: "24px auto", padding: 16 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>AI Chat (Gemini)</h1>
        <button
          type="button"
          onClick={() => {
            try {
              window.localStorage.removeItem(LOCAL_STORAGE_KEY);
            } catch {}
            setApiKey(null);
            setInputKey("");
          }}
          style={{ marginLeft: "auto" }}
        >
          Change API Key
        </button>
      </header>

      <ChatUI apiKey={apiKey} />
    </div>
  );
}

function ChatUI({ apiKey }: { apiKey: string }) {
  const model = useMemo(() => google("gemini-2.5-flash-lite", { apiKey }), [apiKey]);
  const { messages, sendMessage, status, error } = useChat(model, {});

  return (
    <>
      <section style={{ marginTop: 16, padding: 12, border: "1px solid #ddd", borderRadius: 8, minHeight: 300 }}>
        {messages.map((m) => (
          <div key={m.id} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: "#666" }}>{m.role === "user" ? "You" : "AI"}</div>
            {m.parts.map((part, i) => {
              if (part.type === "text") {
                return (
                  <div key={`${m.id}-${i}`} style={{ whiteSpace: "pre-wrap" }}>
                    {part.text}
                  </div>
                );
              }
              return (
                <pre key={`${m.id}-${i}`} style={{ overflowX: "auto", background: "#f7f7f7", padding: 8 }}>
                  {JSON.stringify(part, null, 2)}
                </pre>
              );
            })}
          </div>
        ))}
      </section>

      {status === "error" && (
        <div style={{ color: "#b00020", marginTop: 8 }}>
          Error: {error?.message ?? "Unknown error"}
        </div>
      )}

      <footer style={{ marginTop: 16 }}>
        <input
          placeholder={status !== "ready" ? "Thinking..." : "Message AI..."}
          disabled={status !== "ready"}
          onKeyDown={(e) => {
            const target = e.currentTarget as HTMLInputElement;
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              const value = target.value;
              if (value.trim().length === 0) return;
              sendMessage({ text: value });
              target.value = "";
            }
          }}
          style={{ width: "100%", padding: 10 }}
        />
      </footer>
    </>
  );
}


