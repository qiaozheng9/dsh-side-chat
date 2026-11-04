/** Temporary lifetime around DSH's ordinary Session fork. Chat operations,
 * streaming, approvals, commands and rendering stay with their native owners. */
import type { Context } from './context-types.ts'
import { requireString, SidebarError } from './wire.ts'
import { createTemporarySessions, type TemporarySessions } from './temporary-sessions.ts'

interface SessionView {
  header: { cwd?: string; agentPreset?: string; parentSession?: string }
  snapshotEvents(): readonly { seq: number; type?: string }[]
}
interface Controller {
  fork(request: { sessionId: string; atSeq?: number }): Promise<{ sessionId: string }>
  create(request: { cwd?: string; agentPreset?: string }): Promise<{ sessionId: string }>
  cancel(request: { sessionId: string }): Promise<unknown>
}
/** Completion is published only after the installed deletion owner has stopped
 * writers and removed storage, indexes and workspace references. Its gate then
 * rejects ordinary Session reads, so do not probe a completed identity through
 * those guarded services again. */
function deletionReceipt(id: string): { completed: boolean; pending: boolean } {
  const bridge = (globalThis as Record<symbol, { deleted?: Set<string>; blocked?: Set<string> } | undefined>)[Symbol.for('dsh-delete-session.bridge.v1')]
  return { completed: bridge?.deleted?.has(id) === true, pending: bridge?.blocked?.has(id) === true }
}

export function buildNativeSidechatApi(ctx: Context, owned: TemporarySessions = createTemporarySessions(ctx)) {
  const cutoffs = new Map<string, number>()
  const clientOf = (payload: unknown): string | undefined => {
    const value = (payload as { clientId?: unknown } | null)?.clientId
    if (value === undefined) return undefined
    if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(value)) throw new SidebarError('bad-request', 'Invalid temporary-session client identity')
    return value
  }
  const controller = (): Controller => {
    const value = ctx.get('sessionController') as Controller | undefined
    if (value?.fork === undefined) throw new SidebarError('unavailable', 'This DSH version does not provide native Session forks.', 503)
    return value
  }
  const assertOwned = async (payload: unknown): Promise<string> => {
    const childId = requireString(payload, 'childId')
    if (!(await owned.list()).childIds.includes(childId)) throw new SidebarError('forbidden', 'Only a temporary session created by this plugin can be closed.', 403)
    return childId
  }
  return {
    'sidechat.temporary': async (payload: unknown) => owned.list(clientOf(payload)),
    'sidechat.start': async (payload: unknown) => {
      const sessionId = requireString(payload, 'sessionId')
      const clientId = clientOf(payload)
      const native = controller()
      await owned.list()
      const source = ctx.sessions.get(sessionId) as SessionView | undefined
      if (source !== undefined && !source.snapshotEvents().some(event => event.type === 'user/message' || event.type === 'assistant/message')) {
        throw new SidebarError('bad-request', '主对话有聊天内容后才能打开侧边对话。')
      }
      // The native fork owner can read cold sources. For a live source,
      // request its exact current prefix, including a safely closed open turn.
      const tail = source?.snapshotEvents().at(-1)?.seq
      const child = await native.fork({ sessionId, ...(tail === undefined ? {} : { atSeq: tail }) })
      if (child.sessionId === sessionId) throw new SidebarError('sidechat-error', 'Native fork returned the source session identity.', 500)
      await owned.add(child.sessionId, clientId)
      const permissions = ctx.get('permissionPresets') as {
        current(session: SessionView): string
        set(session: SessionView, value: string): void
      } | undefined
      const childSession = ctx.sessions.get(child.sessionId) as SessionView | undefined
      if (source !== undefined && childSession !== undefined && permissions !== undefined) {
        permissions.set(childSession, permissions.current(source))
      }
      // Inherited inbox rows are historical facts, never fresh submissions.
      const agents = ctx.get('agents') as { get(id: string): { inbox: { clear(): void } } | undefined } | undefined
      agents?.get(child.sessionId)?.inbox.clear()
      // /side's optional first question goes through the native browser input
      // machine after it retains this identity. Failed sends remain retryable
      // drafts instead of hiding an already-created fork from its owner.
      if (childSession === undefined) throw new SidebarError('sidechat-error', 'The native fork is not available for display initialization.', 500)
      const displayStartSeq = (childSession.snapshotEvents().at(-1)?.seq ?? -1) + 1
      cutoffs.set(child.sessionId, displayStartSeq)
      return { childId: child.sessionId, displayStartSeq }
    },
    'sidechat.cancel': async (payload: unknown) => {
      const childId = await assertOwned(payload)
      const receipt = deletionReceipt(childId)
      if (receipt.completed) return { accepted: true, alreadyDeleted: true }
      if (receipt.pending) return { accepted: true }
      const agent = (ctx.get('agents') as { get(id: string): unknown } | undefined)?.get(childId)
      const goals = ctx.get('goals') as { disarm?(agent: unknown): void } | undefined
      if (agent !== undefined) goals?.disarm?.(agent)
      if (agent !== undefined) await controller().cancel({ sessionId: childId })
      return { accepted: true }
    },
    'sidechat.dispose': async (payload: unknown) => {
      const childId = await assertOwned(payload)
      const persistence = ctx.get('sessionPersistence') as { stat(id: string): Promise<unknown> } | undefined
      if (!deletionReceipt(childId).completed && (persistence?.stat === undefined || ctx.sessions.get(childId) !== undefined || await persistence.stat(childId) !== undefined)) {
        throw new SidebarError('sidechat-error', 'Temporary session storage has not been permanently deleted.', 409)
      }
      await owned.remove(childId)
      cutoffs.delete(childId)
      return { accepted: true }
    },
    'sidechat.info': async (payload: unknown) => {
      const id = await assertOwned(payload)
      const agent = (ctx.get('agents') as { get(id: string): { status: string } | undefined } | undefined)?.get(id)
      const session = ctx.sessions.get(id) as SessionView | undefined
      const hasConversation = agent?.status === 'running' || session?.snapshotEvents().some(event => event.seq >= (cutoffs.get(id) ?? 0) && ['user/message', 'assistant/message', 'turn/start'].includes(event.type ?? '')) === true
      return { live: agent !== undefined, status: agent?.status ?? 'idle', hasConversation }
    },
  }
}
