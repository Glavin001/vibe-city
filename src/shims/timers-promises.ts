export function setTimeout(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms))
}

export async function setImmediate(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0))
}


