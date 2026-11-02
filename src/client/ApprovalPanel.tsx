import type { Context } from '../context-types.ts'
import type { SidechatApproval } from '../sidechat-core.ts'
import { nativeElement, useNativeEntry } from './native-controls.tsx'
import type { SideCopy } from './locales.ts'

export function ApprovalPanel({ ctx, pending, copy, answer }: {
  ctx: Context; pending: SidechatApproval; copy: SideCopy
  answer(outcome: 'allowed-once' | 'rejected'): Promise<void>
}): React.ReactNode {
  const native = useNativeEntry(ctx, 'conversation.composer', 'approval')
  if (native !== undefined) return <div data-dsh-side-approval="">{nativeElement(ctx, native, {
    matched: { ...pending, key: pending.id, answerable: true, answer },
    resolveReason: (reason: Record<string, string>) => reason[ctx.locale.getSnapshot().active] ?? reason.en ?? pending.reason,
    renderSlot: () => null,
  })}</div>
  return <div data-dsh-side-approval="" role="group" aria-label={copy.waitingApproval}>
    <strong>{copy.waitingApproval}</strong><p>{pending.reason ?? pending.toolName}</p>
    <button type="button" onClick={() => { void answer('rejected').catch(() => {}) }}>{copy.reject}</button>
    <button type="button" onClick={() => { void answer('allowed-once').catch(() => {}) }}>{copy.allowOnce}</button>
  </div>
}
