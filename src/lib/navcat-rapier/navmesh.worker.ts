/// <reference lib="webworker" />

import { generateSoloNavMeshFromGeometry } from "./generate";
import type { NavMeshBuildCache } from "./generate";
import type {
  NavMeshWorkerRequest,
  NavMeshWorkerResponse,
} from "./navmesh.worker.types";

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;
const cache: NavMeshBuildCache = {};

function handleBuildRequest(request: NavMeshWorkerRequest): void {
  const { id, extraction, options } = request;

  try {
    const result = generateSoloNavMeshFromGeometry(extraction, {
      ...options,
      cache,
    });

    const response: NavMeshWorkerResponse = {
      id,
      type: "result",
      result,
    };

    ctx.postMessage(response);
  } catch (error) {
    const response: NavMeshWorkerResponse = {
      id,
      type: "error",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    };

    ctx.postMessage(response);
  }
}

ctx.addEventListener("message", (event: MessageEvent<NavMeshWorkerRequest>) => {
  const data = event.data;

  if (!data) {
    return;
  }

  if (data.type === "build") {
    handleBuildRequest(data);
  }
});
