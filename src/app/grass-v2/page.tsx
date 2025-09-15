"use client";

import dynamic from "next/dynamic";

const GrassV2Demo = dynamic(() => import("@/components/grassv2/GrassV2Demo"), {
  ssr: false,
});

export default function GrassV2Page() {
  return (
    <div className="fixed inset-0">
      <GrassV2Demo />
    </div>
  );
}


