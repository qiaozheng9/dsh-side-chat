// @vitest-environment jsdom
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { createDisplayProjection, DisplayBoundary, installDisplayBoundary } from '../src/client/display-boundary.tsx'
import { renderRoot, setupReactAct } from './test-utils.ts'
setupReactAct()
function fixture() {
  const old = { anchorSeq: 2 }, current = { anchorSeq: 10 }
  const nodes = new Map([['old', old], ['new', current]])
  const items = [{ turn: 1, anchorKey: 'old' }, { turn: 2, anchorKey: 'new' }]
  const chat = { order: ['old', 'new'], nodes, navigation: { items: () => items } }
  const group = { members: [{ kind: 'node', key: 'old' }, { kind: 'node', key: 'new' }] }
  const source = { getSnapshot: () => group, subscribe: vi.fn() }
  const grouped = { entries: [{ kind: 'node', key: 'old' }, { kind: 'group', key: 'mixed' }], groupSource: () => source }
  const conversation = { activeTargets: new Set(['chat']), views: { get: () => chat, grouped: () => grouped } }
  return { chat, conversation, nodes, group, source }
}
describe('native display boundary', () => {
  it('filters copied rows and navigation while preserving the native nodes and model source', () => {
    const h = fixture(), projection = createDisplayProjection(10)
    const result = projection.chat(h.chat)
    expect(result.order).toEqual(['new'])
    expect(result.navigation.items()).toEqual([{ turn: 2, anchorKey: 'new' }])
    expect(result.nodes).toBe(h.nodes)
    expect(h.chat.order).toEqual(['old', 'new'])
    expect(projection.chat(h.chat)).toBe(result)
    expect(result.navigation.items()).toBe(result.navigation.items())
    expect(projection.chat({ ...h.chat, order: ['old'] }).order).toEqual([])
  })
  it('projects native groups without leaking mixed inherited members, preserving native subscription', () => {
    const h = fixture(), projection = createDisplayProjection(10)
    const result = projection.conversation(h.conversation)
    const groups = result.views.grouped('chat')
    expect(groups.entries).toEqual([{ kind: 'group', key: 'mixed' }])
    const source = groups.groupSource('mixed')
    expect(source.getSnapshot().members).toEqual([{ kind: 'node', key: 'new' }])
    expect(source.subscribe).toBe(h.source.subscribe)
    expect(source.getSnapshot()).toBe(source.getSnapshot())
    expect(h.group.members).toHaveLength(2)
  })
  it('keeps live changes after the cutoff and filters the native trajectory and outline as well', () => {
    const h = fixture(), projection = createDisplayProjection(10)
    h.nodes.set('streaming', { anchorSeq: 11 })
    expect(projection.chat({ ...h.chat, order: [...h.chat.order, 'streaming'] }).order).toEqual(['new', 'streaming'])
    const trajectory = { eventNodes: [{ seq: 1 }, { seq: 10 }], requests: [{ startSeq: 1 }, { startSeq: 11 }], partial: { blocks: [] } }
    expect(projection.trajectory(trajectory)).toEqual({ ...trajectory, eventNodes: [{ seq: 10 }], requests: [{ startSeq: 11 }] })
    const useProjection = vi.fn(() => [{ seq: 1 }, { seq: 10 }])
    const props = projection.props({ useProjection })
    expect(props.useProjection('turnOutline')).toEqual([{ seq: 10 }])
    expect(props.useProjection('inbox')).toBe(useProjection.mock.results[1]?.value)
  })
  it('limits backward paging at the context boundary, allowing older sidebar pages before it is reached', () => {
    const h = fixture(), projection = createDisplayProjection(10)
    const session = { hasMore: true, running: false }
    const useSession = (selector: (value: unknown) => unknown) => selector(session)
    let props = projection.props({ useSession, useChat: (selector: (value: unknown) => unknown) => selector(h.chat) })
    expect(props.useSession((s: { hasMore: boolean }) => s.hasMore)).toBe(false)
    props = projection.props({ useSession, useChat: (selector: (value: unknown) => unknown) => selector({ ...h.chat, order: ['new'] }) })
    expect(props.useSession((s: { hasMore: boolean }) => s.hasMore)).toBe(true)
    expect(session.hasMore).toBe(true)
  })
  it('adapts only native view components, scopes the policy to the side Provider and restores the original seat', () => {
    const Original = vi.fn((props: Record<string, unknown>) => {
      const useChat = props.useChat as (select: (s: { order: string[] }) => string[]) => string[]
      return createElement('p', {}, useChat(s => s.order).join(','))
    })
    const entry = { options: { id: 'chat' }, component: Original }
    const off = vi.fn(), ledger = { entries: () => [entry], subscribe: vi.fn(() => off) }
    const dispose = installDisplayBoundary(ledger)
    const h = fixture(), props = { useChat: (selector: (value: typeof h.chat) => unknown) => selector(h.chat) }
    const root = renderRoot(createElement('div', {}, createElement(entry.component, props), createElement(DisplayBoundary.Provider, { value: 10 }, createElement(entry.component, props))))
    expect(root.container.textContent).toBe('old,newnew')
    root.unmount(); dispose()
    expect(entry.component).toBe(Original)
    expect(off).toHaveBeenCalledOnce()
  })
})
