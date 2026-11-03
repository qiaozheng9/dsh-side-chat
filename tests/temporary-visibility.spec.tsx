// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createTemporaryVisibility } from '../src/client/temporary-visibility.tsx'
const list = { ids: ['main', 'side', 'ordinary-fork'], byId: { main: { title: 'main' }, side: { title: 'side' }, 'ordinary-fork': { title: 'ordinary fork' } }, projectionsBySession: { main: {}, side: {}, 'ordinary-fork': {} } }
describe('temporary conversation visibility', () => {
  it('hides only plugin-owned rows from the left list and search metadata, preserving the native catalog', () => {
    const state = createTemporaryVisibility(), project = state.projector()
    expect(project(list).ids).toEqual([])
    state.initialize(['side'])
    const result = project(list)
    expect(result.ids).toEqual(['main', 'ordinary-fork'])
    expect(result.byId.side).toBeUndefined()
    expect(result.projectionsBySession.side).toBeUndefined()
    expect(result.byId.main).toBe(list.byId.main)
    expect(list.ids).toEqual(['main', 'side', 'ordinary-fork'])
    expect(project(list)).toBe(result)
  })
  it('does not flash new side rows before the native creation reply has supplied their identities', () => {
    const state = createTemporaryVisibility(), project = state.projector()
    state.initialize([])
    const baseline = project({ ...list, ids: ['main'], byId: { main: list.byId.main } })
    const end = state.begin()
    expect(project(list)).toBe(baseline)
    state.add('side'); end()
    expect(project(list).ids).toEqual(['main', 'ordinary-fork'])
    state.remove('side')
    expect(project({ ...list, ids: ['main'], byId: { main: list.byId.main } }).ids).toEqual(['main'])
  })
})
