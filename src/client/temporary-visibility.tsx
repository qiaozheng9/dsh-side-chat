import { createElement, useMemo, useSyncExternalStore, type ComponentType } from 'react'

type Face = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
/** Changes only the native left browser's view, never the Session catalog used
 * by the composer, tools or the independent child SessionProvider. */
export function createTemporaryVisibility() {
  let version = 0, ready = false, pending = 0
  const hidden = new Set<string>(), listeners = new Set<() => void>()
  const emit = (): void => { version++; for (const listener of listeners) listener() }
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    version: () => version,
    initialize(ids: readonly string[]) { for (const id of ids) hidden.add(id); ready = true; emit() },
    begin() { pending++; emit(); let ended = false; return () => { if (!ended) { ended = true; pending--; emit() } } },
    add(id: string) { hidden.add(id); emit() },
    remove(id: string) { hidden.delete(id); emit() },
    projector() {
      let last: Face | undefined, cache = new WeakMap<object, Face>(), revision = -1
      return (snapshot: Face): Face => {
        if (revision !== version) { cache = new WeakMap(); revision = version }
        if (pending > 0 && last !== undefined) return last
        const existing = cache.get(snapshot); if (existing !== undefined) return existing
        const keep = (id: string): boolean => ready && !hidden.has(id)
        const result = { ...snapshot, ids: snapshot.ids.filter(keep), byId: Object.fromEntries(Object.entries(snapshot.byId).filter(([id]) => keep(id))),
          projectionsBySession: Object.fromEntries(Object.entries(snapshot.projectionsBySession ?? {}).filter(([id]) => keep(id))),
        }
        cache.set(snapshot, result)
        if (ready && pending === 0) last = result
        return result
      }
    },
  }
}
export type TemporaryVisibility = ReturnType<typeof createTemporaryVisibility>
interface Entry { component: ComponentType<Face> }
interface Ledger { entries(name: string): readonly Entry[]; subscribe(name: string, listener: () => void): () => void }
export function installTemporaryVisibility(slots: Ledger, visibility: TemporaryVisibility): () => void {
  const decorated = new Map<Entry, { original: ComponentType<Face>; wrapper: ComponentType<Face> }>()
  const scan = (): void => {
    for (const entry of slots.entries('sidebar.workspaces')) {
      if (decorated.has(entry)) continue
      const original = entry.component
      const Wrapper = (props: Face) => {
        useSyncExternalStore(visibility.subscribe, visibility.version)
        const project = useMemo(() => visibility.projector(), [])
        return createElement(original, { ...props,
          useSessions: (selector: (value: Face) => unknown = value => value, ...args: unknown[]) => props.useSessions((snapshot: Face) => selector(project(snapshot)), ...args),
        })
      }
      entry.component = Wrapper; decorated.set(entry, { original, wrapper: Wrapper })
    }
  }
  scan(); const off = slots.subscribe('sidebar.workspaces', scan)
  return () => { off(); for (const [entry, value] of decorated) if (entry.component === value.wrapper) entry.component = value.original; decorated.clear() }
}
