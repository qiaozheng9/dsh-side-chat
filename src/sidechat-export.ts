import { strToU8, zipSync } from 'fflate'
import type { AttachmentStore, FileAttachmentRef, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { SidechatLogEvent } from './sidechat-core.ts'
import { SIDE_BOUNDARY_PREFIX } from './sidechat-core.ts'
import { SidebarError } from './wire.ts'

// Request snapshots and compaction summaries can contain the inherited main
// chat. Export an explicit diagnostic vocabulary, never arbitrary event data.
const TYPES = new Set(['user/message', 'assistant/message', 'tool/call', 'tool/result', 'turn/start', 'turn/end', 'step/start', 'step/end', 'model/selection', 'permission/preset', 'sandbox/mode', 'approval/policy', 'approval/asked', 'approval/decided', 'command/run', 'command/done', 'goal/change', 'goal/round', 'plan/mode'])
const MAX_BYTES = 64 * 1024 * 1024
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function text(content: unknown): string {
  return Array.isArray(content) ? content.flatMap(block => record(block)?.type === 'text' && typeof record(block)?.text === 'string' ? [String(record(block)!.text)] : []).join('\n') : ''
}
export function sideExportEvents(events: readonly SidechatLogEvent[], inheritedEventCount: number): SidechatLogEvent[] {
  return events.filter(event => {
    if (event.seq < inheritedEventCount || !TYPES.has(event.type)) return false
    if (event.type !== 'user/message') return true
    const data = record(event.data)
    const source = record(data?.source)
    return (source?.kind === undefined || source.kind === 'user') && !text(data?.content).startsWith(SIDE_BOUNDARY_PREFIX)
  })
}
function safe(value: string): string { return value.replace(/[^\p{L}\p{N}._-]/gu, '_').replace(/^\.+/, '_').slice(0, 180) || 'attachment' }

/** Only new messages, execution events and their referenced attachments.
 * The copied parent seed and model request snapshots never enter the ZIP. */
export async function sideExportZip(childId: string, events: readonly SidechatLogEvent[], inheritedEventCount: number, attachments?: AttachmentStore, signal?: AbortSignal): Promise<Uint8Array> {
  const own = sideExportEvents(events, inheritedEventCount)
  const entries: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>
  let size = 0
  const add = (path: string, data: Uint8Array) => {
    signal?.throwIfAborted()
    size += data.byteLength
    if (size > MAX_BYTES) throw new SidebarError('bad-request', 'Side chat export exceeds 64 MB')
    entries[path] = data
  }
  add('session.jsonl', strToU8([JSON.stringify({ type: 'side-chat-export', version: 1, sessionId: childId, exportedAt: new Date().toISOString() }), ...own.map(event => JSON.stringify(event)), ''].join('\n')))
  const messages = own.flatMap(event => {
    const data = record(event.data)
    if (event.type === 'user/message') return [`## 用户\n\n${text(data?.content)}`]
    if (event.type === 'assistant/message') {
      const message = record(data?.message)
      const value = text(message?.content ?? data?.content)
      return value === '' ? [] : [`## 助手\n\n${value}`]
    }
    return []
  })
  add('conversation.md', strToU8(`# 侧边对话\n\n${messages.join('\n\n')}\n`))
  add('README.txt', strToU8('此 ZIP 仅包含当前侧边对话新增的消息、执行日志及其引用的附件。\n不包含继承的主对话历史、模型请求快照、主对话日志或其他侧边对话。\n这是诊断与阅读用导出，不是 DSH 会话恢复包。\n'))
  const refs = new Map<string, { type: 'image' | 'file'; value: Record<string, unknown> }>()
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { for (const item of value) visit(item); return }
    const item = record(value)
    if (item === undefined) return
    const ref = record(item.attachment)
    if ((item.type === 'image' || item.type === 'file') && typeof ref?.attachmentId === 'string') refs.set(`${item.type}:${ref.attachmentId}`, { type: item.type, value: ref })
    for (const child of Object.values(item)) visit(child)
  }
  for (const event of own) visit(event.data)
  if (refs.size > 0 && attachments === undefined) throw new SidebarError('unavailable', 'Attachment storage is unavailable', 503)
  for (const { type, value } of refs.values()) {
    signal?.throwIfAborted()
    if (type === 'image') {
      const stored = await attachments!.readImage(value as unknown as ImageAttachmentRef, signal)
      const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' } as Record<string, string>)[stored.ref.mediaType] ?? 'image'
      add(`media/${safe(String(value.attachmentId))}.${extension}`, stored.data)
    } else {
      const chunks: Uint8Array[] = []
      let bytes = 0
      for await (const chunk of attachments!.readFileStream(value as unknown as FileAttachmentRef, signal)) {
        bytes += chunk.byteLength
        if (size + bytes > MAX_BYTES) throw new SidebarError('bad-request', 'Side chat export exceeds 64 MB')
        chunks.push(chunk)
      }
      const data = new Uint8Array(bytes)
      let offset = 0
      for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength }
      add(`files/${safe(String(value.attachmentId))}/${safe(String(value.name ?? 'file'))}`, data)
    }
  }
  signal?.throwIfAborted()
  return zipSync(entries, { level: 6 })
}
