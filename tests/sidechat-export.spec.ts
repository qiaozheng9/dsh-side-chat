import { describe, expect, it, vi } from 'vitest'
import { strFromU8, strToU8, unzipSync } from 'fflate'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { sideExportZip } from '../src/sidechat-export.ts'
import type { SidechatLogEvent } from '../src/sidechat-core.ts'

const event = (type: string, seq: number, data: unknown): SidechatLogEvent => ({ type, seq, time: 0, data })
describe('side chat ZIP scope', () => {
  it('excludes inherited history, boundary snapshots and request/compaction snapshots', async () => {
    const secret = 'PARENT_ONLY_EXPORT_SENTINEL'
    const events = [
      event('user/message', 0, { content: [{ type: 'text', text: secret }], source: { kind: 'user' } }),
      event('user/message', 1, { content: [{ type: 'text', text: secret }], source: { kind: 'dsh-side-chat' } }),
      event('request/header', 2, { header: { prompt: secret } }),
      event('compaction/summary', 3, { summary: secret }),
      event('user/message', 4, { content: [{ type: 'text', text: 'side question' }], source: { kind: 'user' } }),
      event('assistant/message', 5, { message: { content: [{ type: 'text', text: 'side answer' }] } }),
    ]
    const zip = unzipSync(await sideExportZip('side-a', events, 1))
    const text = Object.values(zip).map(value => strFromU8(value)).join('\n')
    expect(text).not.toContain(secret)
    expect(strFromU8(zip['conversation.md']!)).toContain('side question')
    expect(strFromU8(zip['conversation.md']!)).toContain('side answer')
    const log = strFromU8(zip['session.jsonl']!).trim().split('\n').map(line => JSON.parse(line))
    expect(log.slice(1).map(row => row.seq)).toEqual([4, 5])
  })
  it('includes only attachments actually referenced by newly owned side messages', async () => {
    const file = { attachmentId: 'file-child', name: '../../note.txt', bytes: 3 }
    const readFileStream = vi.fn(async function* () { yield strToU8('abc') })
    const attachments = { readFileStream } as unknown as AttachmentStore
    const events = [
      event('user/message', 0, { content: [{ type: 'file', attachment: { attachmentId: 'parent-file' } }] }),
      event('user/message', 1, { source: { kind: 'user' }, content: [{ type: 'text', text: 'read this' }, { type: 'file', attachment: file }] }),
    ]
    const zip = unzipSync(await sideExportZip('side-a', events, 1, attachments))
    const name = Object.keys(zip).find(name => name.startsWith('files/'))!
    expect(name.split('/')).not.toContain('..')
    expect(strFromU8(zip[name]!)).toBe('abc')
    expect(readFileStream).toHaveBeenCalledExactlyOnceWith(file, undefined)
    expect(Object.keys(zip).join(' ')).not.toContain('parent-file')
  })
})
