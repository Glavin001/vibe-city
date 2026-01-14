"use client";

import { useEffect, useRef, useState } from "react";

import { createNavcatBlockStackerScene } from "@/lib/navcat-block-stacker";

export default function NavcatBlockStackerPage() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState("Preparing scene…");
  const [actions, setActions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let handle: Awaited<ReturnType<typeof createNavcatBlockStackerScene>> | null = null;

    createNavcatBlockStackerScene(container, {
      onStatus: (text) => setStatus(text),
      onAction: (text) => setActions((prev) => [text, ...prev].slice(0, 6)),
    })
      .then((sceneHandle) => {
        if (disposed) {
          sceneHandle.dispose();
          return;
        }
        handle = sceneHandle;
      })
      .catch((err) => {
        console.error("[navcat-block-stacker] failed", err);
        setError(err instanceof Error ? err.message : "Failed to start demo");
      });

    return () => {
      disposed = true;
      handle?.dispose();
    };
  }, []);

  return (
    <div className="relative flex h-screen w-full flex-col overflow-hidden bg-slate-950 text-slate-100">
      <div ref={containerRef} className="h-full w-full" />

      <div className="pointer-events-none absolute left-4 top-4 z-10 flex max-w-sm flex-col gap-3 rounded-lg bg-slate-900/70 p-4 text-sm shadow-lg">
        <div className="font-semibold text-lg">Navcat Block Stacker</div>
        <p>
          HTN planner drives the agent to collect blocks and build a staircase. Each placement rebuilds the navmesh tiles so the path to the tower gradually opens.
        </p>
        {error ? (
          <p className="text-red-400">{error}</p>
        ) : (
          <>
            <p className="text-sky-300">{status}</p>
            {actions.length > 0 && (
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-slate-400">Recent actions</p>
                <ul className="space-y-1">
                  {actions.map((action, index) => (
                    <li key={`${action}-${index}`} className="text-xs text-slate-200">
                      • {action}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
