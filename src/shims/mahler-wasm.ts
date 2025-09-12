// Minimal browser shim for mahler-wasm used by planner during build/runtime
// We re-implement diff and patch with shallow JS versions matching Mahler's
// Distance implementation to avoid fs/WebAssembly in the browser.

export type Operation<S = any> = { op: 'update' | 'create' | 'delete'; path: string; target?: any };

function setAtPath(obj: any, path: string, value: any) {
  if (path === '/' || path === '') return value
  const parts = path.split('/').filter(Boolean)
  const res = Array.isArray(obj) ? [...obj] : { ...obj }
  let cur: any = res
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]
    cur[k] = cur[k] == null ? {} : { ...cur[k] }
    cur = cur[k]
  }
  const last = parts[parts.length - 1]
  if (value === undefined) delete cur[last]
  else cur[last] = value
  return res
}

export function patch<S>(state: S, ops: Array<Operation<S>>): S {
  let s: any = state
  for (const o of ops) {
    if (o.op === 'delete') s = setAtPath(s, o.path, undefined)
    else s = setAtPath(s, o.path, o.target)
  }
  return s
}

export function diff<S>(a: S, b: S): Array<Operation<S>> {
  // naive deep-diff that emits updates for differing leaves only
  const out: Array<Operation<S>> = []
  function walk(pa: any, pb: any, base: string) {
    if (pa === pb) return
    const aObj = pa != null && typeof pa === 'object'
    const bObj = pb != null && typeof pb === 'object'
    if (!aObj || !bObj) {
      out.push({ op: 'update', path: base || '/', target: pb })
      return
    }
    const keys = new Set([...Object.keys(pa || {}), ...Object.keys(pb || {})])
    for (const k of keys) {
      const p = base === '/' || base === '' ? `/${k}` : `${base}/${k}`
      if (!(k in pb)) out.push({ op: 'delete', path: p })
      else if (!(k in pa)) out.push({ op: 'create', path: p, target: pb[k] })
      else walk(pa[k], pb[k], p)
    }
  }
  walk(a as any, b as any, '/')
  return out
}


