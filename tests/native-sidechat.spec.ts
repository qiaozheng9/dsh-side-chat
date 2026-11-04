import { describe, expect, it, vi } from 'vitest'
import type { Context } from '../src/context-types.ts'
import { buildNativeSidechatApi } from '../src/native-sidechat.ts'

function fixture(events: { seq: number; type?: string }[] = [{ seq: 0, type: 'user/message' }, { seq: 1 }, { seq: 2 }]) {
  const parent = { header: { cwd: '/workspace', agentPreset: 'native' }, snapshotEvents: () => events }
  const child = { header: { parentSession: 'parent' }, snapshotEvents: () => [...events, { seq: 9 }] }
  const fork = vi.fn().mockResolvedValue({ sessionId: 'child' })
  const create = vi.fn().mockResolvedValue({ sessionId: 'child' })
  const prompt = vi.fn()
  const cancel = vi.fn().mockResolvedValue({ accepted: true })
  const clear = vi.fn()
  const set = vi.fn()
  const disarm = vi.fn()
  let childDeleted = false
  const owned = new Set<string>()
  const ownership = { list: async () => ({ childIds: [...owned], abandonedIds: [] }), add: async (id: string) => { owned.add(id) }, remove: async (id: string) => { owned.delete(id) } }
  const services = {
    sessionController: { fork, create, cancel, prompt },
    agents: { get: vi.fn((id: string) => id === 'child' ? { inbox: { clear }, status: 'idle' } : undefined) },
    permissionPresets: { current: vi.fn().mockReturnValue('workspace-write'), set },
    goals: { disarm },
    sessionPersistence: { stat: vi.fn().mockResolvedValue(undefined) },
  }
  const ctx = { sessions: { get: (id: string) => id === 'parent' ? parent : id === 'child' && !childDeleted ? child : undefined }, get: (key: string) => services[key as keyof typeof services] } as unknown as Context
  return { api: buildNativeSidechatApi(ctx, ownership), fork, create, prompt, cancel, clear, set, disarm, parent, child, services, ctx, deleteChild: () => { childDeleted = true } }
}
describe('native temporary forks', () => {
  it('honors the deletion owner receipt instead of reading an identity guarded against resurrection', async () => {
    const h = fixture(), key = Symbol.for('dsh-delete-session.bridge.v1')
    const globals = globalThis as Record<symbol, unknown>, previous = globals[key]
    await h.api['sidechat.start']({ sessionId: 'parent' })
    globals[key] = { deleted: new Set(['child']), blocked: new Set() }
    try {
      const get = vi.spyOn(h.ctx.sessions, 'get').mockImplementation(() => { throw new Error('Deleted identity is guarded') })
      expect(await h.api['sidechat.cancel']({ childId: 'child' })).toEqual({ accepted: true, alreadyDeleted: true })
      await h.api['sidechat.dispose']({ childId: 'child' })
      expect(get).not.toHaveBeenCalled()
      expect((await h.api['sidechat.temporary']({})).childIds).toEqual([])
    } finally { if (previous === undefined) delete globals[key]; else globals[key] = previous }
  })
  it('delegates the exact source prefix to DSH and never injects a model-facing boundary or starts an extra request', async () => {
    const h = fixture()
    const before = h.parent.snapshotEvents()
    expect(await h.api['sidechat.start']({ sessionId: 'parent', question: 'first question' })).toEqual({ childId: 'child', displayStartSeq: 10 })
    expect(h.fork).toHaveBeenCalledExactlyOnceWith({ sessionId: 'parent', atSeq: 2 })
    expect(h.prompt).not.toHaveBeenCalled()
    expect(h.parent.snapshotEvents()).toBe(before)
    expect(h.set).toHaveBeenCalledExactlyOnceWith(h.child, 'workspace-write')
    expect(h.clear).toHaveBeenCalledOnce()
  })
  it('refuses an empty main conversation without creating a temporary session', async () => {
    const h = fixture([])
    await expect(h.api['sidechat.start']({ sessionId: 'parent' })).rejects.toThrow('主对话有聊天内容')
    expect(h.fork).not.toHaveBeenCalled()
    expect(h.create).not.toHaveBeenCalled()
  })
  it('ignores inherited history when deciding whether the side chat has started', async () => {
    const h = fixture()
    await h.api['sidechat.start']({ sessionId: 'parent' })
    expect((await h.api['sidechat.info']({ childId: 'child' })).hasConversation).toBe(false)
    const before = h.child.snapshotEvents()
    h.child.snapshotEvents = () => [...before, { seq: 10, type: 'user/message' }]
    expect((await h.api['sidechat.info']({ childId: 'child' })).hasConversation).toBe(true)
  })
  it('leaves cold-source observation and fork balancing to the native owner', async () => {
    const h = fixture()
    await h.api['sidechat.start']({ sessionId: 'cold-source' })
    expect(h.fork).toHaveBeenCalledExactlyOnceWith({ sessionId: 'cold-source' })
  })
  it('refuses cancellation or disposal of the parent and unrelated sessions', async () => {
    const h = fixture()
    await expect(h.api['sidechat.cancel']({ childId: 'parent' })).rejects.toThrow('Only a temporary session')
    await expect(h.api['sidechat.dispose']({ childId: 'other' })).rejects.toThrow('Only a temporary session')
    expect(h.cancel).not.toHaveBeenCalled()
  })
  it('stops only its owned fork, disarms auto continuation, and releases bookkeeping after confirmed storage deletion', async () => {
    const h = fixture()
    await h.api['sidechat.start']({ sessionId: 'parent' })
    await h.api['sidechat.cancel']({ childId: 'child' })
    expect(h.cancel).toHaveBeenCalledExactlyOnceWith({ sessionId: 'child' })
    expect(h.disarm).toHaveBeenCalledOnce()
    await expect(h.api['sidechat.dispose']({ childId: 'child' })).rejects.toThrow('not been permanently deleted')
    h.deleteChild()
    await h.api['sidechat.dispose']({ childId: 'child' })
    await expect(h.api['sidechat.cancel']({ childId: 'child' })).rejects.toThrow('Only a temporary session')
  })
  it('retains temporary ownership until persisted files have actually been deleted', async () => {
    const h = fixture()
    await h.api['sidechat.start']({ sessionId: 'parent' })
    h.deleteChild()
    h.services.sessionPersistence.stat.mockResolvedValueOnce({ header: {} })
    await expect(h.api['sidechat.dispose']({ childId: 'child' })).rejects.toThrow('not been permanently deleted')
    expect((await h.api['sidechat.temporary']({})).childIds).toEqual(['child'])
    await h.api['sidechat.dispose']({ childId: 'child' })
    expect((await h.api['sidechat.temporary']({})).childIds).toEqual([])
  })
  it('fails explicitly when the required native fork owner is unavailable', async () => {
    const api = buildNativeSidechatApi({ sessions: { get: () => undefined }, get: () => undefined } as unknown as Context)
    await expect(api['sidechat.start']({ sessionId: 'parent' })).rejects.toThrow('native Session forks')
  })
})
