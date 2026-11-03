/** Temporary lifetime around DSH's ordinary Session fork. Chat operations,
 * streaming, approvals, commands and rendering stay with their native owners. */
import type { Context } from './context-types.ts'
import { requireString, SidebarError } from './wire.ts'

interface SessionView {
  header: { cwd?: string; agentPreset?: string; parentSession?: string }
  snapshotEvents(): readonly { seq: number }[]
}
interface Controller {
  fork(request: { sessionId: string; atSeq?: number }): Promise<{ sessionId: string }>
  create(request: { cwd?: string; agentPreset?: string }): Promise<{ sessionId: string }>
  cancel(request: { sessionId: string }): Promise<unknown>
}

export function buildNativeSidechatApi(ctx: Context) {
  const owned = new Set<string>()
  const controller = (): Controller => {
    const value = ctx.get('sessionController') as Controller | undefined
    if (value?.fork === undefined) throw new SidebarError('unavailable', 'This DSH version does not provide native Session forks.', 503)
    return value
  }
  const assertOwned = (payload: unknown): string => {
    const childId = requireString(payload, 'childId')
    if (!owned.has(childId)) throw new SidebarError('forbidden', 'Only a temporary session created by this plugin can be closed.', 403)
    return childId
  }
  return {
    'sidechat.start': async (payload: unknown) => {
      const sessionId = requireString(payload, 'sessionId')
      const source = ctx.sessions.get(sessionId) as SessionView | undefined
      // The native fork owner can read cold sources. For a live source,
      // request its exact current prefix, including a safely closed open turn.
      const tail = source?.snapshotEvents().at(-1)?.seq
      const native = controller()
      const child = source !== undefined && tail === undefined
        ? await native.create({ cwd: source.header.cwd, agentPreset: source.header.agentPreset })
        : await native.fork({ sessionId, ...(tail === undefined ? {} : { atSeq: tail }) })
      if (child.sessionId === sessionId) throw new SidebarError('sidechat-error', 'Native fork returned the source session identity.', 500)
      owned.add(child.sessionId)
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
      return { childId: child.sessionId }
    },
    'sidechat.cancel': async (payload: unknown) => {
      const childId = assertOwned(payload)
      const agent = (ctx.get('agents') as { get(id: string): unknown } | undefined)?.get(childId)
      const goals = ctx.get('goals') as { disarm?(agent: unknown): void } | undefined
      if (agent !== undefined) goals?.disarm?.(agent)
      await controller().cancel({ sessionId: childId })
      return { accepted: true }
    },
    'sidechat.dispose': async (payload: unknown) => {
      owned.delete(assertOwned(payload))
      return { accepted: true }
    },
    'sidechat.info': async (payload: unknown) => {
      const id = assertOwned(payload)
      const agent = (ctx.get('agents') as { get(id: string): { status: string } | undefined } | undefined)?.get(id)
      return { live: agent !== undefined, status: agent?.status ?? 'idle' }
    },
  }
}
