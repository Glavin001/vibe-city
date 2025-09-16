"use client";

import dynamic from "next/dynamic";

const GrassDemo = dynamic(() => import("@/components/GrassDemo"), {
  ssr: false,
});

export default function GrassPage() {
  return (
    <div className="fixed inset-0 bg-gray-900">
      <GrassDemo />
    </div>
  );
}
