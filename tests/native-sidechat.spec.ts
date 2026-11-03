import { describe, expect, it, vi } from 'vitest'
import type { Context } from '../src/context-types.ts'
import { buildNativeSidechatApi } from '../src/native-sidechat.ts'

function fixture(events: { seq: number }[] = [{ seq: 0 }, { seq: 1 }, { seq: 2 }]) {
  const parent = { header: { cwd: '/workspace', agentPreset: 'native' }, snapshotEvents: () => events }
  const child = { header: { parentSession: 'parent' }, snapshotEvents: () => [] }
  const fork = vi.fn().mockResolvedValue({ sessionId: 'child' })
  const create = vi.fn().mockResolvedValue({ sessionId: 'child' })
  const prompt = vi.fn()
  const cancel = vi.fn().mockResolvedValue({ accepted: true })
  const clear = vi.fn()
  const set = vi.fn()
  const disarm = vi.fn()
  const services = {
    sessionController: { fork, create, cancel, prompt },
    agents: { get: vi.fn((id: string) => id === 'child' ? { inbox: { clear }, status: 'idle' } : undefined) },
    permissionPresets: { current: vi.fn().mockReturnValue('workspace-write'), set },
    goals: { disarm },
  }
  const ctx = { sessions: { get: (id: string) => id === 'parent' ? parent : id === 'child' ? child : undefined }, get: (key: string) => services[key as keyof typeof services] } as unknown as Context
  return { api: buildNativeSidechatApi(ctx), fork, create, prompt, cancel, clear, set, disarm, parent, child, services, ctx }
}
describe('native temporary forks', () => {
  it('delegates the exact source prefix to DSH and never injects a model-facing boundary or starts an extra request', async () => {
    const h = fixture()
    const before = h.parent.snapshotEvents()
    expect(await h.api['sidechat.start']({ sessionId: 'parent', question: 'first question' })).toEqual({ childId: 'child' })
    expect(h.fork).toHaveBeenCalledExactlyOnceWith({ sessionId: 'parent', atSeq: 2 })
    expect(h.prompt).not.toHaveBeenCalled()
    expect(h.parent.snapshotEvents()).toBe(before)
    expect(h.set).toHaveBeenCalledExactlyOnceWith(h.child, 'workspace-write')
    expect(h.clear).toHaveBeenCalledOnce()
  })
  it('creates an ordinary native session when there is no history to fork yet', async () => {
    const h = fixture([])
    await h.api['sidechat.start']({ sessionId: 'parent' })
    expect(h.fork).not.toHaveBeenCalled()
    expect(h.create).toHaveBeenCalledExactlyOnceWith({ cwd: '/workspace', agentPreset: 'native' })
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
    await h.api['sidechat.dispose']({ childId: 'child' })
    await expect(h.api['sidechat.cancel']({ childId: 'child' })).rejects.toThrow('Only a temporary session')
  })
  it('fails explicitly when the required native fork owner is unavailable', async () => {
    const api = buildNativeSidechatApi({ sessions: { get: () => undefined }, get: () => undefined } as unknown as Context)
    await expect(api['sidechat.start']({ sessionId: 'parent' })).rejects.toThrow('native Session forks')
  })
})
