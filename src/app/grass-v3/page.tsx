"use client";

import dynamic from "next/dynamic";

const GrassV3Demo = dynamic(() => import("@/components/grassv3/GrassV3Demo"), {
  ssr: false,
});

export default function GrassV3Page() {
  return (
    <div className="fixed inset-0 bg-gray-900">
      <GrassV3Demo />
    </div>
  );
}
