import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createSideQuestions } from '../src/sidechat-questions.ts'

function harness() {
  let listener!: (request: unknown, next: () => unknown) => Promise<unknown>
  const on = vi.fn((_key: string, callback: typeof listener) => { listener = callback })
  const agent = { id: 'side', ctx: { on } } as unknown as Agent
  const bridge = createSideQuestions(vi.fn())
  bridge.install(agent)
  const request = (signal?: AbortSignal, owner = agent) => listener({ agent: owner, signal, questions: [{ id: 'review', question: 'Approve?', detail: '# Plan', options: [{ label: 'Approve' }, { label: 'Keep planning' }], intent: { kind: 'plan-review', approve: 'Approve' } }] }, () => 'delegated')
  return { bridge, request, on }
}
describe('side chat plan reviews and questions', () => {
  it('waits for an explicit answer from the exact child and validates options', async () => {
    const { bridge, request, on } = harness()
    const result = request()
    expect(on.mock.calls[0]).toContain('user-questions/request')
    const pending = bridge.list('side')[0]!
    const answer = { answers: [{ id: 'review', selected: ['Approve'] }] }
    expect(() => { bridge.answer('parent', pending.id, answer) }).toThrow('no longer pending')
    expect(() => { bridge.answer('side', pending.id, { answers: [{ id: 'review', selected: ['unknown'] }] }) }).toThrow('Invalid question answer')
    bridge.answer('side', pending.id, answer)
    await expect(result).resolves.toEqual(answer)
    expect(bridge.list('side')).toEqual([])
    expect(() => { bridge.answer('side', pending.id, answer) }).toThrow('no longer pending')
  })
  it('cancels unanswered reviews on stop and close instead of granting a plan', async () => {
    const { bridge, request } = harness()
    const controller = new AbortController()
    const result = request(controller.signal)
    controller.abort()
    await expect(result).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    const next = request()
    bridge.release('side')
    await expect(next).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    expect(bridge.list('side')).toEqual([])
  })
  it('delegates requests from other live agents and keeps selected feedback explicit', async () => {
    const { bridge, request } = harness()
    expect(request(undefined, { id: 'parent' } as Agent)).toBe('delegated')
    const result = request()
    const id = bridge.list('side')[0]!.id
    const answer = { answers: [{ id: 'review', selected: ['Keep planning'], custom: 'Please revise step two.' }] }
    bridge.answer('side', id, answer)
    await expect(result).resolves.toEqual(answer)
  })
})
