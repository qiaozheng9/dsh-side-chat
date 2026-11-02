// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sideApi } from '../src/client/api.ts'

afterEach(() => { vi.unstubAllGlobals() })
const ok = (value: unknown) => new Response(JSON.stringify({ ok: true, value }), { headers: { 'content-type': 'application/json' } })
describe('temporary session deletion transaction', () => {
  it('deletes only the confirmed child before releasing plugin references', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(ok({ accepted: true })).mockResolvedValueOnce(ok({ sessionId: 'child', token: 'nonce' })).mockResolvedValueOnce(ok({ sessionIds: ['child'] })).mockResolvedValueOnce(ok({ accepted: true }))
    vi.stubGlobal('fetch', fetch)
    await sideApi.dispose('child')
    expect(fetch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(['/side-chat/api/sidechat.cancel', '/api/delete-session/preview', '/api/delete-session/execute', '/side-chat/api/sidechat.dispose'])
    expect(JSON.parse(fetch.mock.calls[2]![1].body)).toEqual({ sessionId: 'child', token: 'nonce', stopActivity: true })
  })
  it('refuses a mismatched deletion confirmation', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(ok({ accepted: true })).mockResolvedValueOnce(ok({ sessionId: 'parent', token: 'nonce' }))
    vi.stubGlobal('fetch', fetch)
    await expect(sideApi.dispose('child')).rejects.toThrow('Invalid temporary-session')
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('does not report success when storage cleanup fails', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(ok({ accepted: true })).mockResolvedValueOnce(ok({ sessionId: 'child', token: 'nonce' })).mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: { message: 'write owner busy' } }), { status: 409 }))
    vi.stubGlobal('fetch', fetch)
    await expect(sideApi.dispose('child')).rejects.toThrow('write owner busy')
    expect(fetch).toHaveBeenCalledTimes(3)
  })
  it('does not silently retain history when the deletion service is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok({ accepted: true })).mockResolvedValueOnce(new Response('', { status: 404 })))
    await expect(sideApi.dispose('child')).rejects.toThrow('Permanent session deletion is unavailable')
  })
})
