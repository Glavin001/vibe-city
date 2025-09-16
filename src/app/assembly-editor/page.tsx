"use client";

import React from "react";

import AssemblyEditor from "@/components/builder/AssemblyEditor";

export default function AssemblyEditorPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex max-w-7xl flex-col gap-10 px-6 py-12">
        <header className="space-y-4 text-center">
          <h1 className="text-4xl font-bold text-slate-50">
            Assembly Playground – Structures & Vehicles
          </h1>
          <p className="mx-auto max-w-3xl text-base text-slate-300">
            Experiment with part-based construction, constraint-driven joints, and
            articulated physics. The demo ships with a hinge-driven house scene and a
            drivable rover that uses Rapier motors for its wheel articulations.
          </p>
        </header>
        <AssemblyEditor />
        <footer className="text-center text-sm text-slate-500">
          <p>
            Controls: <strong>Edit</strong> mode exposes a transform gizmo, while
            <strong> Simulate</strong> mode activates Rapier physics, keyboard drive
            (WASD / arrow keys), and live joint targets.
          </p>
        </footer>
      </div>
    </main>
  );
}
