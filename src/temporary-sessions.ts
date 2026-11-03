import { mkdir, readFile, rename, rmdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { Context } from './context-types.ts'

export interface TemporarySessions {
  list(clientId?: string): Promise<{ childIds: string[]; abandonedIds: string[] }>
  add(id: string, clientId?: string): Promise<void>
  remove(id: string): Promise<void>
}
/** Only exact plugin-created identities are recorded. No conversation content.
 * Keep ownership across host restarts so abandoned copies can be deleted safely. */
export function createTemporarySessions(ctx: Context): TemporarySessions {
  let loaded: Promise<void> | undefined
  let queue = Promise.resolve()
  const ids = new Set<string>(), abandoned = new Set<string>()
  const owners = new Map<string, string>()
  const path = (): string => {
    const persistence = ctx.get('sessionPersistence') as { root?: string } | undefined
    if (persistence?.root === undefined || !isAbsolute(persistence.root)) throw new Error('Native session storage is unavailable for temporary-session ownership.')
    return join(resolve(dirname(persistence.root)), 'storages', 'dsh-side-chat', 'temporary-sessions.json')
  }
  const load = (): Promise<void> => loaded ??= (async () => {
    for (const file of [path(), `${path()}.tmp`]) {
      try {
        const data: unknown = JSON.parse(await readFile(file, 'utf8'))
        if (!Array.isArray(data)) throw new Error('Invalid temporary-session ownership registry')
        for (const value of data) {
          const entry = typeof value === 'string' ? { id: value } : value as { id?: unknown; clientId?: unknown } | null
          if (entry === null || typeof entry?.id !== 'string' || !/^session-[a-zA-Z0-9-]+$/.test(entry.id) || (entry.clientId !== undefined && typeof entry.clientId !== 'string')) throw new Error('Invalid temporary-session ownership registry')
          ids.add(entry.id); abandoned.add(entry.id)
          if (typeof entry.clientId === 'string') owners.set(entry.id, entry.clientId)
        }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
  })()
  const save = async (): Promise<void> => {
    const file = path()
    if (ids.size === 0) {
      await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error })
      await unlink(`${file}.tmp`).catch(error => { if (error.code !== 'ENOENT') throw error })
      await rmdir(dirname(file)).catch(error => { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error })
      return
    }
    await mkdir(dirname(file), { recursive: true })
    const temporary = `${file}.tmp`
    await writeFile(temporary, JSON.stringify([...ids].map(id => ({ id, ...(owners.has(id) ? { clientId: owners.get(id) } : {}) }))), { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, file)
  }
  const change = (id: string, add: boolean, clientId?: string): Promise<void> => {
    const task = queue.then(async () => {
      await load()
      const before = new Set(ids)
      const previousOwner = owners.get(id)
      if (add) { ids.add(id); if (clientId !== undefined) owners.set(id, clientId) } else { ids.delete(id); owners.delete(id) }
      try { await save(); if (!add) abandoned.delete(id) }
      catch (error) { ids.clear(); for (const previous of before) ids.add(previous); if (previousOwner === undefined) owners.delete(id); else owners.set(id, previousOwner); throw error }
    })
    queue = task.catch(() => {}); return task
  }
  return {
    async list(clientId) { await queue; await load(); return { childIds: [...ids], abandonedIds: [...new Set([...abandoned, ...[...ids].filter(id => clientId !== undefined && owners.get(id) === clientId)])] } },
    add: (id, clientId) => change(id, true, clientId), remove: id => change(id, false),
  }
}
