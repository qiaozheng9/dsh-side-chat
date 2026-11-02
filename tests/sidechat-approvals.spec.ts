import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { createSideApprovals } from '../src/sidechat-approvals.ts'

function harness() {
  let listener!: (request: ApprovalRequest, next: () => Promise<'unavailable'>) => Promise<string>
  const agent = { id: 'child', ctx: { on: vi.fn((_key: string, value: typeof listener) => { listener = value }) } } as unknown as Agent
  const invalidate = vi.fn()
  const approvals = createSideApprovals(invalidate)
  approvals.install(agent)
  return { agent, approvals, invalidate, request: (signal?: AbortSignal) => listener({ agent, toolName: 'write_file', reason: 'Outside workspace', signal }, async () => 'unavailable') }
}
describe('side agent approvals', () => {
  it('waits for an explicit decision and refuses answers from another child', async () => {
    const h = harness()
    const result = h.request()
    const pending = h.approvals.list('child')[0]!
    expect(pending.toolName).toBe('write_file')
    expect(() => { h.approvals.answer('parent', pending.id, 'allowed-once') }).toThrow('no longer pending')
    expect(() => { h.approvals.answer('child', pending.id, 'allow-always') }).toThrow('Invalid approval outcome')
    h.approvals.answer('child', pending.id, 'rejected')
    await expect(result).resolves.toBe('rejected')
    expect(h.approvals.list('child')).toEqual([])
    expect(h.invalidate).toHaveBeenCalledWith('child')
  })
  it('grants only the specific request once and rejects late repeated answers', async () => {
    const h = harness()
    const result = h.request()
    const pending = h.approvals.list('child')[0]!
    h.approvals.answer('child', pending.id, 'allowed-once')
    await expect(result).resolves.toBe('allowed-once')
    expect(() => { h.approvals.answer('child', pending.id, 'allowed-once') }).toThrow('no longer pending')
  })
  it('withdraws pending decisions on cancellation and releases them on disposal', async () => {
    const h = harness()
    const controller = new AbortController()
    const result = h.request(controller.signal)
    controller.abort()
    await expect(result).resolves.toBe('unavailable')
    const next = h.request()
    h.approvals.dispose()
    await expect(next).resolves.toBe('unavailable')
    expect(h.approvals.list('child')).toEqual([])
  })
})
