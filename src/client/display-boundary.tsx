import { createContext, createElement, useContext, useMemo, type ComponentType } from 'react'

/** Display policy only. The native Session and its model context stay intact. */
export const DisplayBoundary = createContext<number | undefined>(undefined)
type Face = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Hook = (selector?: (snapshot: Face) => unknown, ...args: unknown[]) => unknown

export function createDisplayProjection(firstSeq: number) {
  const cache = new WeakMap<object, Face>()
  const arrays = new WeakMap<object, unknown[]>()
  const filtered = <T,>(items: readonly T[], keep: (item: T) => boolean): T[] => {
    const previous = arrays.get(items)
    if (previous !== undefined) return previous as T[]
    const result = items.filter(keep); arrays.set(items, result); return result
  }
  const chat = (snapshot: Face): Face => {
    const previous = cache.get(snapshot); if (previous !== undefined) return previous
    const order = filtered<string>(snapshot.order, key => (snapshot.nodes.get(key)?.anchorSeq ?? -1) >= firstSeq)
    const result = { ...snapshot, order, navigation: { ...snapshot.navigation,
      items: () => filtered<Face>(snapshot.navigation.items(), item => order.includes(item.anchorKey)),
    } }
    cache.set(snapshot, result); return result
  }
  const conversation = (snapshot: Face): Face => {
    const previous = cache.get(snapshot); if (previous !== undefined) return previous
    const target = snapshot.views.get('chat')
    const keys = new Set<string>(target === undefined ? [] : chat(target).order)
    const grouped = snapshot.views.grouped('chat')
    const sources = new Map<string, Face>()
    const groupSource = (key: string): Face => {
      let source = sources.get(key)
      if (source !== undefined) return source
      const original = grouped.groupSource(key)
      source = { subscribe: original.subscribe, getSnapshot: () => {
        const group = original.getSnapshot(); if (group === undefined) return group
        const cached = cache.get(group); if (cached !== undefined) return cached
        const next = { ...group, members: group.members.filter((entry: Face) => keys.has(entry.key)) }
        cache.set(group, next); return next
      } }; sources.set(key, source); return source
    }
    const result = { ...snapshot, views: { ...snapshot.views,
      get: (name: string) => name === 'chat' && target !== undefined ? chat(target) : snapshot.views.get(name),
      grouped: (name: string) => name !== 'chat' || grouped === undefined ? snapshot.views.grouped(name) : {
        entries: grouped.entries.filter((entry: Face) => entry.kind === 'node' ? keys.has(entry.key) : groupSource(entry.key).getSnapshot()?.members.length > 0),
        groupSource,
      },
    } }
    cache.set(snapshot, result); return result
  }
  const trajectory = (snapshot: Face): Face => {
    const previous = cache.get(snapshot); if (previous !== undefined) return previous
    const result = { ...snapshot,
      eventNodes: snapshot.eventNodes.filter((node: Face) => node.seq >= firstSeq),
      requests: snapshot.requests.filter((request: Face) => request.startSeq >= firstSeq),
    }; cache.set(snapshot, result); return result
  }
  const hook = (original: Hook, project: (snapshot: Face) => Face): Hook => (selector = value => value, ...args) => original(value => selector(project(value)), ...args)
  const props = (original: Face): Face => {
    const result = { ...original }
    const reachedBoundary = original.useChat !== undefined
      ? original.useChat((value: Face) => value.order.length === 0 || (value.nodes.get(value.order[0])?.anchorSeq ?? -1) < firstSeq)
      : original.useTrajectory !== undefined
        ? original.useTrajectory((value: Face) => value.eventNodes.length === 0 || value.eventNodes[0].seq < firstSeq)
        : false
    if (original.useChat !== undefined) result.useChat = hook(original.useChat, chat)
    if (original.useConversation !== undefined) result.useConversation = hook(original.useConversation, conversation)
    if (original.useTrajectory !== undefined) result.useTrajectory = hook(original.useTrajectory, trajectory)
    if (original.useProjection !== undefined) result.useProjection = (name: string, ...args: unknown[]) => {
      const value = original.useProjection(name, ...args)
      return name === 'turnOutline' && Array.isArray(value) ? filtered<Face>(value, item => item.seq >= firstSeq) : value
    }
    if (original.useSession !== undefined) result.useSession = hook(original.useSession, value => ({ ...value, hasMore: value.hasMore && !reachedBoundary }))
    return result
  }
  return { chat, conversation, trajectory, props }
}

interface Entry { component: ComponentType<Face>; options: { id?: string } }
interface Ledger { entries(name: string): readonly Entry[]; subscribe(name: string, listener: () => void): () => void }
/** rc.5 has no transcript-offset option. Adapt the public, mutable entry seat
 * while preserving its native inject/store/authorized renderSlot. Restore the
 * exact component on unload; normal conversations receive their original props.
 * No Session object, event, source or model prompt is modified. */
export function installDisplayBoundary(slots: Ledger): () => void {
  const decorated = new Map<Entry, { original: ComponentType<Face>; wrapper: ComponentType<Face> }>()
  const scan = (): void => {
    for (const entry of slots.entries('conversation.view')) {
      if (!['chat', 'trajectory'].includes(entry.options.id ?? '') || decorated.has(entry)) continue
      const original = entry.component
      const Wrapper = (props: Face) => {
        const firstSeq = useContext(DisplayBoundary)
        const projection = useMemo(() => firstSeq === undefined ? undefined : createDisplayProjection(firstSeq), [firstSeq])
        return createElement(original, projection === undefined ? props : projection.props(props))
      }
      entry.component = Wrapper; decorated.set(entry, { original, wrapper: Wrapper })
    }
  }
  scan(); const off = slots.subscribe('conversation.view', scan)
  return () => { off(); for (const [entry, { original, wrapper }] of decorated) if (entry.component === wrapper) entry.component = original; decorated.clear() }
}
