"use client";

import dynamic from "next/dynamic";

const InstancedMesh2Demo = dynamic(
  () => import("@/components/InstancedMesh2Demo"),
  { ssr: false }
);

export default function InstancedMesh2Page() {
  return (
    <div className="fixed inset-0">
      <InstancedMesh2Demo />
    </div>
  );
}


