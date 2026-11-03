import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSideThreads } from '../src/client/store.ts'
import { sideApi } from '../src/client/api.ts'
vi.mock('../src/client/api.ts', () => ({ sideApi: { start: vi.fn(), dispose: vi.fn().mockResolvedValue({}) } }))
afterEach(() => { vi.clearAllMocks() })
describe('temporary side threads', () => {
  it('keeps the first prompt on retry and numbers each parent independently', async () => {
    vi.mocked(sideApi.start).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ childId: 'child', displayStartSeq: 100 })
    const store = createSideThreads()
    const first = store.create('main', 'why?')
    await first.ready
    expect(first.error).toBe('offline')
    store.retry(first); await first.ready
    expect(sideApi.start).toHaveBeenLastCalledWith('main', 'why?')
    expect(first.childId).toBe('child')
    expect(first.displayStartSeq).toBe(100)
    expect(store.create('main').index).toBe(2)
    expect(store.create('other').index).toBe(1)
    store.dispose()
  })
  it('releases a child that finishes creating after its tab closes', async () => {
    let finish!: (value: { childId: string; displayStartSeq: number }) => void
    vi.mocked(sideApi.start).mockReturnValue(new Promise(resolve => { finish = resolve }))
    const store = createSideThreads()
    const record = store.create('main')
    const ready = record.ready
    const closing = store.close(record.id)
    finish({ childId: 'late-child', displayStartSeq: 0 }); await ready
    await closing
    expect(sideApi.dispose).toHaveBeenCalledExactlyOnceWith('late-child')
    expect(store.get(record.id)).toBeUndefined()
  })
  it('never evicts active threads and closes each child once', async () => {
    vi.mocked(sideApi.start).mockResolvedValue({ childId: 'child', displayStartSeq: 0 })
    const store = createSideThreads()
    const records = Array.from({ length: 64 }, () => store.create('main'))
    await Promise.all(records.map(record => record.ready))
    expect(() => store.create('main')).toThrow('Close a side chat')
    const closing = store.close(records[0]!.id)
    expect(store.close(records[0]!.id)).toBe(closing)
    await closing
    expect(sideApi.dispose).toHaveBeenCalledTimes(1)
    expect(store.create('main').index).toBe(65)
    store.dispose()
  })
})
