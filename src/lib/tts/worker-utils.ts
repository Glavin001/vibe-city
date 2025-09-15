export async function detectWebGPU(): Promise<boolean> {
  try {
    // Guard for environments where navigator or gpu may be undefined
    const nav =
      (typeof self !== "undefined"
        ? (self as unknown as { navigator?: unknown }).navigator
        : undefined) ??
      (typeof globalThis !== "undefined"
        ? (globalThis as unknown as { navigator?: unknown }).navigator
        : undefined);

    type WithGpu = { gpu?: { requestAdapter?: () => Promise<unknown> } };
    const gpu = (nav as WithGpu | undefined)?.gpu;
    if (!gpu || typeof gpu.requestAdapter !== "function") return false;
    const adapter = await gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}


