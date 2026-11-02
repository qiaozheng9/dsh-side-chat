import { sideApi } from './api.ts'

export interface SideThread {
  id: string
  parentId: string
  index: number
  childId?: string
  ready?: Promise<void>
  error?: string
  quote?: string
  question: string
  closed: boolean
  closing?: Promise<void>
  requestClose?: () => void
}

/** Activation-owned records: StrictMode and hidden tab remounts share one start. */
export function createSideThreads() {
  const records = new Map<string, SideThread>()
  const listeners = new Set<() => void>()
  let revision = 0
  const emit = (): void => { revision++; for (const listener of listeners) listener() }
  const start = (record: SideThread): void => {
    if (record.ready !== undefined || record.closed) return
    record.error = undefined
    record.ready = sideApi.start(record.parentId, record.question).then(async ({ childId }) => {
      record.childId = childId
    }).catch((error: unknown) => {
      record.error = error instanceof Error ? error.message : String(error)
    }).finally(() => { record.ready = undefined; emit() })
    emit()
  }
  const close = (id: string): Promise<void> => {
    const record = records.get(id)
    if (record === undefined || record.closed) return Promise.resolve()
    if (record.closing !== undefined) return record.closing
    record.error = undefined
    record.closing = Promise.resolve().then(async () => {
      await record.ready
      if (record.childId !== undefined) await sideApi.dispose(record.childId)
      record.closed = true
      records.delete(id)
    }).catch((error: unknown) => {
      record.error = error instanceof Error ? error.message : String(error)
      throw error
    }).finally(() => { record.closing = undefined; emit() })
    emit()
    return record.closing
  }
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    version: () => revision,
    get: (id: string) => records.get(id),
    create(parentId: string, question = '', quote?: string): SideThread {
      // Never evict an active thread to satisfy a cache limit.
      if (records.size >= 64) throw new Error('Close a side chat before opening another one.')
      const index = [...records.values()].filter(record => record.parentId === parentId).reduce((max, record) => Math.max(max, record.index), 0) + 1
      const record: SideThread = { id: crypto.randomUUID(), parentId, index, quote, question, closed: false }
      records.set(record.id, record)
      start(record)
      return record
    },
    retry: (record: SideThread) => { if (record.childId === undefined) start(record) },
    close,
    dispose() { for (const id of [...records.keys()]) void close(id).catch(error => { console.error('[dsh-side] temporary session cleanup failed', error) }); listeners.clear() },
  }
}
export type SideThreads = ReturnType<typeof createSideThreads>
