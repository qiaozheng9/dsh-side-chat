import { describe, expect, it, vi } from 'vitest'
import { sideCommandSource, sideQuestion } from '../src/client/commands.ts'
import { sideCopy } from '../src/client/locales.ts'
describe('/side host input source', () => {
  it('exposes no side command in an empty conversation and rechecks restored claims', async () => {
    let available = false
    const open = vi.fn(), source = sideCommandSource(open, () => sideCopy('en'), () => available)
    const session = { sessionId: 'main' }
    expect(source.lexicon(session)).toEqual([])
    expect(await source.candidates(session, { query: 'side', position: 'leading' })).toEqual([])
    expect(source.matchSpace(session, '/side')).toBeUndefined()
    expect(await source.matchClaim(session, '/side')).toBeUndefined()
    await expect(source.matchEnter(session, '/side', new AbortController().signal, { attachments: 0 })).rejects.toThrow('unavailable in an empty conversation')
    expect(source.onPick({ session })).toBeUndefined()
    available = true
    expect(source.lexicon(session)).toEqual(['side'])
    const claim = await source.matchClaim(session, '/side')
    available = false
    expect(await claim!.submit('', {} as never, [])).toHaveProperty('kind', 'error')
    expect(open).not.toHaveBeenCalled()
  })
  it('matches only the complete command and preserves multiline questions', () => {
    expect(sideQuestion('/side')).toBe('')
    expect(sideQuestion(' /side 为什么？\n具体说明 ')).toBe('为什么？\n具体说明')
    expect(sideQuestion('/sidebar')).toBeUndefined()
    expect(sideQuestion('explain /side')).toBeUndefined()
  })
  it('opens in the invoking session through Enter, menu and a restored chip', async () => {
    const open = vi.fn()
    const source = sideCommandSource(open, () => sideCopy('zh'))
    const session = { sessionId: 'main' }
    const outcome = await source.matchEnter(session, '/side why', new AbortController().signal, { attachments: 0 })
    expect(outcome).toHaveProperty('claim')
    if (outcome === undefined || outcome === 'handled' || !('claim' in outcome)) throw new Error('claim missing')
    await outcome.claim.submit('why', {} as never, [])
    expect(open).toHaveBeenLastCalledWith('main', 'why')
    source.onPick({ session }); expect(open).toHaveBeenLastCalledWith('main')
    const claim = await source.matchClaim(session, '/side ')
    expect(claim).toBeDefined()
    expect(await claim!.submit('next', {} as never, [])).toEqual({ kind: 'success' })
    expect(open).toHaveBeenLastCalledWith('main', 'next')
  })
  it('leaves other commands and cancelled submissions alone and refuses dropped attachments', async () => {
    const open = vi.fn()
    const source = sideCommandSource(open, () => sideCopy('en'))
    const session = { sessionId: 'main' }
    expect(await source.matchEnter(session, '/status', new AbortController().signal, { attachments: 0 })).toBeUndefined()
    const abort = new AbortController(); abort.abort()
    expect(await source.matchEnter(session, '/side why', abort.signal, { attachments: 0 })).toBeUndefined()
    await expect(source.matchEnter(session, '/side why', new AbortController().signal, { attachments: 1 })).rejects.toThrow('Remove attachments')
    expect(open).not.toHaveBeenCalled()
    expect(await source.candidates(session, { query: 'si', position: 'leading' })).toHaveLength(1)
    expect(await source.candidates(session, { query: 'side', position: 'inline' })).toEqual([])
  })
})
