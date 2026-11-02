import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '../src/context-types.ts'
import { createSideActions } from '../src/sidechat-actions.ts'

function harness() {
  const events = [{ type: 'user/message', seq: 0, time: 0, data: { content: [{ type: 'text', text: 'parent-only' }] } }]
  const child = { id: 'side-a', status: 'idle', session: { snapshotEvents: () => events } } as unknown as Agent
  const other = { id: 'side-b', status: 'idle' } as unknown as Agent
  const execute = vi.fn(async () => ({ result: { kind: 'success', text: 'Compacted 3 history items.' } }))
  const ctx = { get: (key: string) => key === 'commands' ? { execute } : undefined } as unknown as Context
  const actions = createSideActions(ctx, vi.fn())
  actions.own('side-a', child, 1); actions.own('side-b', other, 1)
  return { actions, child, execute }
}
describe('side chat action ownership', () => {
  it('reads the native durable plan state when preset isolation hides its service and projection', async () => {
    const events = [
      { type: 'plan/mode', data: { active: true } },
      { type: 'command/run', data: { name: 'plan', args: 'off', commandId: 'cmd' } },
      { type: 'command/done', data: { commandId: 'cmd', kind: 'success' } },
    ]
    const child = { id: 'side', session: { snapshotEvents: () => events }, ctx: { get: () => undefined } } as unknown as Agent
    const execute = vi.fn(async () => ({ result: { kind: 'success' } }))
    const commands = { execute, find: vi.fn(() => ({ name: 'plan' })) }
    const actions = createSideActions({ get: (key: string) => key === 'commands' ? commands : undefined } as unknown as Context, vi.fn())
    actions.own('side', child, 0)
    expect(actions.capabilities('side').plan).toBe(true)
    expect(actions.state('side')).toEqual({ plan: { active: true, pending: false } })
    events.push({ type: 'plan/mode', data: { active: false } })
    expect(actions.state('side')).toEqual({ plan: { active: false } })
  })
  it('uses the native plan projection and command when the controller is private', async () => {
    const child = { id: 'side', session: {}, ctx: { get: () => undefined } } as unknown as Agent
    const projection = { active: true, wanted: false, running: null }
    const execute = vi.fn(async () => ({ result: { kind: 'success' } }))
    const find = vi.fn(() => ({ name: 'plan' }))
    const table = { commands: { execute, find }, sessionProjections: { stateOf: vi.fn(() => projection) } }
    const actions = createSideActions({ get: (key: string) => table[key as keyof typeof table] } as unknown as Context, vi.fn())
    actions.own('side', child, 0)
    expect(actions.capabilities('side').plan).toBe(true)
    expect(find).toHaveBeenCalledWith(child, 'plan')
    expect(actions.state('side')).toEqual({ plan: { active: true, pending: false } })
    await actions.plan('side', false)
    expect(execute).toHaveBeenCalledExactlyOnceWith(child, '/plan off', [], expect.any(AbortSignal))
  })
  it('finds plan mode in the child preset scope even when the plugin root has none', async () => {
    const get = vi.fn(() => ({ active: false }))
    const child = { id: 'side', ctx: { get: (key: string) => key === 'planMode' ? { get } : undefined } } as unknown as Agent
    const execute = vi.fn(async () => ({ result: { kind: 'success' } }))
    const actions = createSideActions({ get: (key: string) => key === 'commands' ? { execute } : undefined } as unknown as Context, vi.fn())
    actions.own('side', child, 0)
    expect(actions.capabilities('side').plan).toBe(true)
    expect(actions.state('side')).toEqual({ plan: { active: false } })
    expect(get).toHaveBeenCalledWith(child)
    await actions.plan('side', true)
    expect(execute).toHaveBeenCalledExactlyOnceWith(child, '/plan', [], expect.any(AbortSignal))
  })
  it('binds goal mutations and native plan commands to the selected side, rejecting stale refs', async () => {
    const child = { id: 'side-a', status: 'idle', session: {} } as Agent
    const other = { id: 'side-b', status: 'idle', session: {} } as Agent
    const goal = { id: 'goal-a', revision: 2, phase: 'active', objective: 'Side objective' }
    const goals = { get: vi.fn((agent: Agent) => agent === child ? goal : undefined), edit: vi.fn(), pause: vi.fn(), clear: vi.fn(), create: vi.fn(), resume: vi.fn(), disarm: vi.fn() }
    const execute = vi.fn(async () => ({ result: { kind: 'success', text: 'Plan mode on.' } }))
    const table = { goals, commands: { execute }, planMode: { get: vi.fn((agent: Agent) => ({ active: agent === child })) } }
    const actions = createSideActions({ get: (key: string) => table[key as keyof typeof table] } as unknown as Context, vi.fn())
    actions.own('side-a', child, 0); actions.own('side-b', other, 0)
    expect(actions.state('side-b')).toEqual({ plan: { active: false } })
    await expect(actions.goal('parent', 'clear', undefined, goal)).rejects.toMatchObject({ status: 403 })
    await expect(actions.goal('side-a', 'edit', 'New objective', { id: goal.id, revision: 1 })).rejects.toMatchObject({ status: 409 })
    expect(goals.edit).not.toHaveBeenCalled()
    await actions.goal('side-a', 'edit', 'New objective', { id: goal.id, revision: 2 })
    expect(goals.edit).toHaveBeenCalledExactlyOnceWith(child, { id: goal.id, revision: 2 }, { objective: 'New objective' })
    await actions.goal('side-a', 'pause', undefined, { id: goal.id, revision: 2 })
    expect(goals.pause).toHaveBeenCalledExactlyOnceWith(child, { id: goal.id, revision: 2 })
    await expect(actions.plan('parent', true)).rejects.toMatchObject({ status: 403 })
    await actions.plan('side-a', true)
    expect(execute).toHaveBeenCalledExactlyOnceWith(child, '/plan', [], expect.any(AbortSignal))
    await actions.plan('side-a', false)
    expect(execute).toHaveBeenLastCalledWith(child, '/plan off', [], expect.any(AbortSignal))
    actions.cancel('side-a')
    expect(goals.disarm).toHaveBeenCalledExactlyOnceWith(child)
    actions.release('side-a')
    expect(() => actions.state('side-a')).toThrow('Only the current temporary side chat')
  })
  it('runs only the allowed native command on the exact selected child', async () => {
    const { actions, child, execute } = harness()
    await expect(actions.compact('side-a')).resolves.toEqual({ text: 'Compacted 3 history items.' })
    expect(execute).toHaveBeenCalledExactlyOnceWith(child, '/compact', [], expect.any(AbortSignal))
  })
  it('refuses main or unknown identities before touching commands or logs', async () => {
    const { actions, execute } = harness()
    await expect(actions.compact('parent')).rejects.toMatchObject({ status: 403 })
    await expect(actions.export('parent')).rejects.toMatchObject({ status: 403 })
    expect(execute).not.toHaveBeenCalled()
    actions.release('side-a')
    await expect(actions.export('side-a')).rejects.toMatchObject({ status: 403 })
  })
  it('prevents duplicate operations and allows closing to cancel compaction', async () => {
    const { actions, execute } = harness()
    execute.mockImplementation((_agent?: unknown, _line?: unknown, _attachments?: unknown, signal?: AbortSignal) => new Promise((_resolve, reject) => { signal!.addEventListener('abort', () => { reject(new Error('cancelled')) }) }))
    const first = actions.compact('side-a')
    await expect(actions.compact('side-a')).rejects.toMatchObject({ status: 409 })
    actions.cancel('side-a')
    await expect(first).rejects.toThrow('cancelled')
    expect(execute).toHaveBeenCalledTimes(1)
  })
})
