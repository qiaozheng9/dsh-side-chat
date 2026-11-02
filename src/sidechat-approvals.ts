import { randomUUID } from 'node:crypto'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { SidechatApproval } from './sidechat-core.ts'
import { SidebarError } from './wire.ts'

/** Side agents are not selected root sessions, so their approval waterfall
 * needs an answerable presentation of its own. No implicit grants. */
export function createSideApprovals(invalidate: (id: string) => void, manual: (agent: Agent) => boolean = () => true) {
  const installed = new WeakSet<Agent>()
  const pending = new Map<string, { childId: string; view: SidechatApproval; finish(outcome: 'allowed-once' | 'rejected' | 'unavailable'): void }>()
  return {
    install(agent: Agent) {
      if (installed.has(agent)) return
      installed.add(agent)
      agent.ctx.on('approval/request', (request: ApprovalRequest, next) => {
        if (request.agent.id !== agent.id || !manual(agent)) return next()
        if (request.signal?.aborted === true) return Promise.resolve('unavailable' as const)
        return new Promise<'allowed-once' | 'rejected' | 'unavailable'>(resolve => {
          const id = randomUUID()
          const aborted = () => finish('unavailable')
          const finish = (outcome: 'allowed-once' | 'rejected' | 'unavailable') => {
            if (!pending.delete(id)) return
            request.signal?.removeEventListener('abort', aborted)
            invalidate(agent.id); resolve(outcome)
          }
          pending.set(id, { childId: agent.id, view: {
            id, toolName: request.toolName,
            ...(request.callId === undefined ? {} : { callId: request.callId }),
            ...(request.reason === undefined ? {} : { reason: request.reason }),
            ...(request.displayReason === undefined ? {} : { displayReason: { ...request.displayReason } }),
          }, finish })
          request.signal?.addEventListener('abort', aborted, { once: true })
          invalidate(agent.id)
        })
      }, { prepend: true })
    },
    list(childId: string) { return [...pending.values()].filter(item => item.childId === childId).map(item => item.view) },
    answer(childId: string, id: string, outcome: unknown) {
      const item = pending.get(id)
      if (item === undefined || item.childId !== childId) throw new SidebarError('not-found', 'Approval is no longer pending', 404)
      if (outcome !== 'allowed-once' && outcome !== 'rejected') throw new SidebarError('bad-request', 'Invalid approval outcome')
      item.finish(outcome)
    },
    release(childId: string) { for (const item of [...pending.values()]) if (item.childId === childId) item.finish('unavailable') },
    dispose() { for (const item of [...pending.values()]) item.finish('unavailable') },
  }
}
