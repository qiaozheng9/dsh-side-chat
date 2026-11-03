import { hostRouteUrl } from './host-route-url.ts'
import type { SidechatTaskState } from '../sidechat-core.ts'
import type { SidechatLiveEvent, SidechatLogEvent, SidechatPendingInput, SidechatThreadInfo, SidechatModelCatalog, SidechatModelSelection, SidechatPermissions, SidechatAttachment } from '../sidechat-core.ts'

export async function sideCall<T>(method: string, payload: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(hostRouteUrl(`side-chat/api/${method}`), {
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload), signal,
  })
  const result = await response.json() as { ok: boolean; value?: T; error?: { message: string } }
  if (!response.ok || !result.ok) throw new Error(result.error?.message ?? `HTTP ${response.status}`)
  return result.value as T
}

export interface SideFeed {
  events: SidechatLogEvent[]
  live: SidechatLiveEvent[]
  pending: SidechatPendingInput[]
}

/** Reuse the installed storage owner's deletion transaction, including indexes
 * and unshared attachments. Never unlink a JSONL file behind a live writer. */
async function deleteTemporarySession(childId: string): Promise<void> {
  // Stop a pending /compact before the storage owner drains the agent.
  await sideCall('sidechat.cancel', { childId })
  const call = async <T>(method: string, payload: unknown): Promise<T> => {
    const response = await fetch(hostRouteUrl(`api/delete-session/${method}`), {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    })
    if (!response.ok && response.status === 404) throw new Error('Permanent session deletion is unavailable. Enable dsh-delete-session and retry closing.')
    const result = await response.json() as { ok: boolean; value: T; error?: { message: string } }
    if (!response.ok || !result.ok) throw new Error(result.error?.message ?? `HTTP ${response.status}`)
    return result.value
  }
  const preview = await call<{ sessionId: string; token: string }>('preview', { sessionId: childId })
  if (preview.sessionId !== childId || typeof preview.token !== 'string') throw new Error('Invalid temporary-session deletion confirmation')
  const deleted = await call<{ sessionIds: string[] }>('execute', { sessionId: childId, token: preview.token, stopActivity: true })
  if (!deleted.sessionIds.includes(childId)) throw new Error('Temporary-session deletion was not completed')
  await sideCall('sidechat.dispose', { childId })
}
export const sideApi = {
  start: (sessionId: string, question = '') => sideCall<{ childId: string; displayStartSeq: number }>('sidechat.start', { sessionId, question }),
  prompt: (childId: string, text: string, attachments?: SidechatAttachment[]) => sideCall('sidechat.prompt', { childId, text, ...(attachments === undefined ? {} : { attachments }) }),
  permissions: (childId: string, signal?: AbortSignal) => sideCall<SidechatPermissions>('sidechat.permissions', { childId }, signal),
  permission: (childId: string, preset: string) => sideCall<SidechatPermissions>('sidechat.permission', { childId, preset, acknowledged: preset === 'danger-full-access' || preset === 'auto' }),
  approval: (childId: string, approvalId: string, outcome: 'allowed-once' | 'rejected') => sideCall('sidechat.approval', { childId, approvalId, outcome }),
  cancel: (childId: string) => sideCall('sidechat.cancel', { childId }),
  dispose: deleteTemporarySession,
  models: (signal?: AbortSignal) => sideCall<SidechatModelCatalog>('sidechat.models', {}, signal),
  actions: (childId: string, signal?: AbortSignal) => sideCall<{ compact: boolean; export: boolean; goal: boolean; plan: boolean }>('sidechat.actions', { childId }, signal),
  taskState: (childId: string, signal?: AbortSignal) => sideCall<SidechatTaskState>('sidechat.taskState', { childId }, signal),
  goal: (childId: string, action: string, objective?: string, ref?: { id: string; revision: number }) => sideCall<SidechatTaskState>('sidechat.goal', { childId, action, objective, ref }),
  plan: (childId: string, active: boolean) => sideCall<SidechatTaskState>('sidechat.plan', { childId, active }),
  question: (childId: string, questionId: string, answer: unknown) => sideCall('sidechat.question', { childId, questionId, answer }),
  compact: (childId: string) => sideCall<{ text: string }>('sidechat.compact', { childId }),
  export: (childId: string) => sideCall<{ fileName: string; data: string }>('sidechat.export', { childId }),
  model: (childId: string, selection: SidechatModelSelection) => sideCall<{ accepted: true; selection: SidechatModelSelection }>('sidechat.model', { childId, ...selection }),
  info: (childId: string, signal?: AbortSignal) => sideCall<SidechatThreadInfo>('sidechat.info', { childId }, signal),
  events: (childId: string, afterSeq?: number, signal?: AbortSignal) => sideCall<SideFeed>('sidechat.events', { childId, afterSeq }, signal),
  dequeue: (childId: string, messageId: string) => sideCall('sidechat.dequeue', { childId, messageId }),
}
