// @vitest-environment jsdom
import { act } from 'react-dom/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.tsx'
import type { Context } from '../src/context-types.ts'
import { setupReactAct } from './test-utils.ts'
import { renderRoot } from './test-utils.ts'
import { createElement, type ComponentType } from 'react'
vi.mock('../src/client/NativeSideChatPanel.tsx', () => ({ NativeSideChatPanel: () => null, NativeConversation: () => null, NATIVE_CONVERSATION_SLOT: 'dsh-side-chat.conversation' }))
vi.mock('../src/client/api.ts', () => ({ sideApi: { temporary: vi.fn().mockResolvedValue({ childIds: [], abandonedIds: [] }), dispose: vi.fn() } }))
setupReactAct()
function context(failTitle = false) {
  const cleanup: (() => void)[] = []
  const removed = vi.fn()
  const closed = vi.fn()
  const slots: { name: string; id?: string; key?: string }[] = []
  const registrations = new Map<string, { options: { inject?: (id: string) => Record<string, unknown> }; component: unknown }>()
  let closeHandler: ((sessionId: string, tab: { id: string }) => void) | undefined
  const kinds: { kind: string }[] = []
  const source = vi.fn(() => () => {})
  const locale = { active: 'en' }
  const ctx = {
    locale: { getSnapshot: () => locale, subscribe: () => () => {} },
    get: (name: string) => ({
      sidebarRight: { registerCloseHandler: (_kind: string, callback: typeof closeHandler) => { closeHandler = callback; return closed } },
      sidebarRightTabs: { register: (def: { kind: string }) => { kinds.push(def); return removed } },
      inputTriggers: { registerSource: source },
    })[name],
    inject: (_deps: string[], callback: (ctx: unknown) => void) => { callback(ctx); return () => {} },
    effect: (fn: () => (() => void)) => { const off = fn(); cleanup.push(off); return off },
    slots: {
      entries: () => [], subscribe: () => () => {},
      inject: (_name: string, callback: () => (() => void)) => callback(),
      register: (spec: { name: string; id?: string; key?: string; inject?: (id: string) => Record<string, unknown> }, component: unknown) => {
        if (failTitle && spec.name.endsWith('.title')) throw new Error('title seat unavailable')
        slots.push(spec); registrations.set(spec.name, { options: spec, component }); return () => {}
      },
    },
  }
  return { ctx: ctx as unknown as Context, kinds, slots, registrations, closeTab: (id: string, tab: { id: string }) => closeHandler?.(id, tab), source, removed, closed, dispose: () => { cleanup.reverse().forEach(off => off()) } }
}
describe('native side chat contribution', () => {
  it('removes a restored side tab in an empty main chat without creating a fork', () => {
    const h = context(); act(() => { apply(h.ctx) })
    const entry = h.registrations.get('sidebar.right.pane.tab')!
    const face = entry.options.inject!('empty-parent')
    const create = vi.spyOn(face.threads as { create(): unknown }, 'create')
    const close = vi.fn(), signal = new AbortController().signal
    const Component = entry.component as ComponentType<Record<string, unknown>>
    const root = renderRoot(createElement(Component, { ...face, useTabInfo: () => ({ tab: { id: 'restored', signal, actions: { close } } }) }))
    expect(create).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce()
    root.unmount(); act(() => { h.dispose() })
  })
  it('does not create a replacement fork when a confirmed-closed native tab body remounts during removal', () => {
    const h = context(); act(() => { apply(h.ctx) })
    const entry = h.registrations.get('sidebar.right.pane.tab')!
    const face = entry.options.inject!('parent')
    const bindings = face.bindings as Map<string, unknown>
    const threads = face.threads as { create(): unknown }
    const create = vi.spyOn(threads, 'create')
    bindings.set('parent:tab', { id: 'record', parentId: 'parent', index: 1, question: '', closed: true })
    h.closeTab('parent', { id: 'tab' })
    expect(bindings.has('parent:tab')).toBe(true)
    const Component = entry.component as ComponentType<Record<string, unknown>>
    const props = { ...face, useTabInfo: () => ({ tab: { id: 'tab', signal: new AbortController().signal } }) }
    const first = renderRoot(createElement(Component, props)); first.unmount()
    const second = renderRoot(createElement(Component, props)); second.unmount()
    expect(create).not.toHaveBeenCalled()
    act(() => { h.dispose() })
  })
  it('registers one native kind and a uniquely identified composer entry, then unmounts cleanly', () => {
    const h = context()
    act(() => { apply(h.ctx) })
    expect(h.kinds.map(item => item.kind)).toEqual(['dsh-side-chat'])
    expect(h.slots.find(item => item.name === 'conversation.input.left')?.id).toBe('dsh-side:open')
    expect(h.source).toHaveBeenCalledTimes(1)
    expect(document.querySelectorAll('[data-dsh-side-selection]')).toHaveLength(1)
    act(() => { h.dispose() })
    expect(h.removed).toHaveBeenCalledTimes(1)
    expect(h.closed).toHaveBeenCalledTimes(1)
    expect(document.querySelectorAll('[data-dsh-side-selection]')).toHaveLength(0)
  })
  it('rolls back the native type if a later slot fails to register', () => {
    const h = context(true)
    expect(() => apply(h.ctx)).toThrow('title seat unavailable')
    expect(h.removed).toHaveBeenCalledTimes(1)
    expect(h.closed).toHaveBeenCalledTimes(1)
    h.dispose()
    expect(h.removed).toHaveBeenCalledTimes(1)
  })
})
