"use client";

import dynamic from "next/dynamic";

const EzTreeClient = dynamic(() => import("./EzTreeClient"), { ssr: false });

export default function EzTreePage() {
  return <EzTreeClient />;
}
