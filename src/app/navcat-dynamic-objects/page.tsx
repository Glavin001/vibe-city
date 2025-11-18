"use client";

import { useEffect, useRef, useState } from 'react';

import { createNavcatDynamicObjectsScene } from '@/lib/navcat-dynamic-objects';

export default function NavcatDynamicObjectsPage() {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isReady, setIsReady] = useState(false);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        let disposed = false;
        let handle: Awaited<ReturnType<typeof createNavcatDynamicObjectsScene>> | null = null;

        createNavcatDynamicObjectsScene(container)
            .then((result) => {
                if (disposed) {
                    result.dispose();
                    return;
                }
                handle = result;
                setIsReady(true);
            })
            .catch((err) => {
                console.error(err);
                setError(err instanceof Error ? err.message : 'Failed to initialize scene');
            });

        return () => {
            disposed = true;
            if (handle) {
                handle.dispose();
            }
        };
    }, []);

    return (
        <div className="relative flex h-screen w-full flex-col overflow-hidden bg-black text-white">
            <div ref={containerRef} className="h-full w-full" id="navcat-dynamic-objects-root" />

            <div className="pointer-events-none absolute left-4 top-4 z-10 max-w-sm space-y-3 rounded-lg bg-black/70 p-4 text-sm leading-relaxed shadow-lg">
                <h1 className="text-lg font-semibold">Navcat Dynamic Obstacles</h1>
                <p>
                    Click anywhere on the navmesh to set a new target for the crowd agents. Red physics cubes continually rebuild the
                    navigation mesh as they tumble through the level.
                </p>
                <p>
                    Toggle the path visualization with the GUI on the right. Use the mouse to orbit, pan, and zoom around the scene.
                </p>
                {!isReady && !error && <p className="animate-pulse text-yellow-300">Loading WebGPU scene…</p>}
                {error && <p className="text-red-400">{error}</p>}
            </div>
        </div>
    );
}