import { mkdtemp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '../src/context-types.ts'
import { createTemporarySessions } from '../src/temporary-sessions.ts'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-side-ownership-')); roots.push(root)
  const ctx = { get: () => ({ root: join(root, 'sessions') }) } as unknown as Context
  return { root, ctx, file: join(root, 'storages', 'dsh-side-chat', 'temporary-sessions.json') }
}
describe('durable temporary ownership', () => {
  it('records only exact temporary identities and recovers abandoned copies after a new host starts', async () => {
    const h = await fixture(), first = createTemporarySessions(h.ctx)
    await Promise.all([first.add('session-a'), first.add('session-b')])
    expect(await first.list()).toEqual({ childIds: ['session-a', 'session-b'], abandonedIds: [] })
    expect(JSON.parse(await readFile(h.file, 'utf8'))).toEqual([{ id: 'session-a' }, { id: 'session-b' }])
    expect(await createTemporarySessions(h.ctx).list()).toEqual({ childIds: ['session-a', 'session-b'], abandonedIds: ['session-a', 'session-b'] })
  })
  it('reclaims copies after the same browser reloads without selecting another live window’s copies', async () => {
    const h = await fixture(), store = createTemporarySessions(h.ctx)
    await store.add('session-a', 'window-a'); await store.add('session-b', 'window-b')
    expect((await store.list('window-a')).abandonedIds).toEqual(['session-a'])
    expect((await store.list('window-b')).abandonedIds).toEqual(['session-b'])
    expect((await store.list()).abandonedIds).toEqual([])
  })
  it('cleans its registry and interrupted-write file after the last confirmed deletion', async () => {
    const h = await fixture(), store = createTemporarySessions(h.ctx)
    await store.add('session-a'); await writeFile(`${h.file}.tmp`, '["session-a"]')
    await store.remove('session-a')
    await expect(access(h.file)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(`${h.file}.tmp`)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(join(h.root, 'storages', 'dsh-side-chat'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('recovers a completed ownership write interrupted before rename', async () => {
    const h = await fixture()
    await mkdir(join(h.root, 'storages', 'dsh-side-chat'), { recursive: true })
    await writeFile(`${h.file}.tmp`, '["session-interrupted"]')
    expect((await createTemporarySessions(h.ctx).list()).abandonedIds).toEqual(['session-interrupted'])
  })
  it('refuses malformed registries instead of guessing which user sessions to delete', async () => {
    const h = await fixture()
    await mkdir(join(h.root, 'storages', 'dsh-side-chat'), { recursive: true })
    await writeFile(h.file, '["../../main"]')
    await expect(createTemporarySessions(h.ctx).list()).rejects.toThrow('Invalid temporary-session')
  })
})
