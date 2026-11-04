// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react'
import { act } from 'react-dom/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeConversation, NativeSideChatPanel, NATIVE_CONVERSATION_SLOT } from '../src/client/NativeSideChatPanel.tsx'
import type { Context } from '../src/context-types.ts'
import type { SideThread, SideThreads } from '../src/client/store.ts'
import { sideApi } from '../src/client/api.ts'
import { DisplayBoundary } from '../src/client/display-boundary.tsx'
import { renderRoot, setupReactAct, type RenderedRoot } from './test-utils.ts'

const dialog = vi.hoisted(() => vi.fn(() => null))
vi.mock('../src/client/CloseDialog.tsx', () => ({ CloseDialog: dialog }))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ FishLogo: () => createElement('svg', { 'data-native-fish': '' }) }))
vi.mock('../src/client/api.ts', () => ({ sideApi: { info: vi.fn().mockResolvedValue({ live: true, status: 'idle', hasConversation: false }) } }))
setupReactAct()
let root: RenderedRoot | undefined
afterEach(() => { root?.unmount(); root = undefined; vi.clearAllMocks() })

describe('native conversation embedding', () => {
  it.each([false, true])('unmounts and releases the native reference before deletion, restoring it only on genuine failure: %s', async fail => {
    let released = false
    const release = vi.fn(() => { released = true })
    const binding = { ctx: {} }
    const retained = { ready: Promise.resolve(), release, get binding() { if (released) throw new Error('Session reference is released'); return binding } }
    const fresh = { ready: Promise.resolve(), release: vi.fn(), binding }
    const retain = vi.fn().mockReturnValueOnce(retained).mockReturnValue(fresh)
    const locale = { active: 'en' }
    const ctx = { get: () => ({ refresh: async () => {}, retain }), locale: { getSnapshot: () => locale, subscribe: () => () => {} } } as unknown as Context
    const record: SideThread = { id: 'tab', parentId: 'parent', childId: 'child', index: 1, question: '', closed: false }
    let finish!: () => void
    const gate = new Promise<void>(resolve => { finish = resolve })
    const close = vi.fn(async () => {
      expect(root!.container.querySelector('[data-child-scope]')).toBeNull()
      expect(release).toHaveBeenCalledOnce()
      await gate
      if (fail) { record.error = 'Storage is busy'; throw new Error(record.error) }
      record.closed = true
    })
    const threads = { subscribe: () => () => {}, version: () => 0, close, markConversation: vi.fn() } as unknown as SideThreads
    const onClose = vi.fn()
    const Provider = ({ session, children }: { session: { binding: unknown }; children: ReactNode }) => { void session.binding; return createElement('div', { 'data-child-scope': '' }, children) }
    root = renderRoot(createElement(NativeSideChatPanel, { ctx, threads, record, visible: true, onNew: vi.fn(), onClose, SessionProvider: Provider, renderSlot: () => createElement('div', {}, 'native messages') }))
    await act(async () => {})
    expect(root.container.querySelector('[data-child-scope]')).not.toBeNull()
    await act(async () => { root!.container.querySelector<HTMLButtonElement>('button[aria-label="Close side chat"]')!.click() })
    expect(close).toHaveBeenCalledOnce()
    expect(root.container.querySelector('[data-child-scope]')).toBeNull()
    expect(root.container.querySelector('[role="status"]')?.textContent).toContain('Deleting')
    await act(async () => { finish() })
    if (fail) {
      expect(onClose).not.toHaveBeenCalled()
      expect(root.container.querySelector('[role="alert"]')?.textContent).toContain('Storage is busy')
      expect(retain.mock.calls.map(call => call[0])).toEqual(['child', 'child'])
      expect(root.container.querySelector('[data-child-scope]')).not.toBeNull()
    } else { expect(onClose).toHaveBeenCalledOnce(); expect(root.container.querySelector('[role="alert"]')).toBeNull() }
  })
  it('shows the native brand for inherited-only context and removes it after the first new message', () => {
    const nodes = new Map([['old', { anchorSeq: 2 }], ['new', { anchorSeq: 10 }]])
    const view = (order: string[]) => createElement(DisplayBoundary.Provider, { value: 10 }, createElement(NativeConversation, {
      useSession: selector => selector({ blank: false, awaitingFirstTurn: false, running: false, promptAttempted: false, openState: 'open' }),
      useConversation: selector => selector({ activeTargets: new Set(['chat']), views: { get: () => ({ order, nodes }) } }),
      renderFactorySlot: () => createElement('div', { 'data-native-chat': '' }),
    }))
    root = renderRoot(view(['old']))
    expect(root.container.querySelector('[data-side-welcome] [data-native-fish]')).not.toBeNull()
    root.rerender(view(['old', 'new']))
    expect(root.container.querySelector('[data-side-welcome]')).toBeNull()
    expect(root.container.querySelector('[data-native-chat]')).not.toBeNull()
  })
  it.each([false, true])('closes an untouched side without confirmation and asks after a new conversation: %s', async hasConversation => {
    vi.mocked(sideApi.info).mockResolvedValueOnce({ live: true, status: 'idle', hasConversation })
    const record: SideThread = { id: 'tab', parentId: 'parent', childId: 'child', displayStartSeq: 10, index: 1, question: '', closed: false }
    const close = vi.fn().mockResolvedValue(undefined), onClose = vi.fn(), markConversation = vi.fn()
    const threads = { subscribe: () => () => {}, version: () => 0, close, markConversation } as unknown as SideThreads
    const locale = { active: 'en' }
    const ctx = { get: () => ({ refresh: async () => {}, retain: () => ({ binding: { ctx: {} }, ready: Promise.resolve(), release() {} }) }), locale: { getSnapshot: () => locale, subscribe: () => () => {} } } as unknown as Context
    root = renderRoot(createElement(NativeSideChatPanel, { ctx, threads, record, visible: true, onNew: vi.fn(), onClose, SessionProvider: ({ children }) => children, renderSlot: () => null }))
    await act(async () => {})
    await act(async () => { root!.container.querySelector<HTMLButtonElement>('button[aria-label="Close side chat"]')!.click() })
    if (hasConversation) { expect(dialog).toHaveBeenCalled(); expect(close).not.toHaveBeenCalled(); expect(markConversation).toHaveBeenCalledWith(record) }
    else { expect(dialog).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledExactlyOnceWith('tab'); expect(onClose).toHaveBeenCalledOnce() }
  })
  it('uses the official embedded content Factory instead of building its own transcript or composer', () => {
    const factory = vi.fn(() => createElement('div', { 'data-native-factory': '' }, 'native chat'))
    root = renderRoot(createElement(NativeConversation, {
      useSession: selector => selector({ blank: false, awaitingFirstTurn: false, running: false, promptAttempted: true, openState: 'open' }),
      useConversation: selector => selector({ activeTargets: new Set(['chat']) }), renderFactorySlot: factory,
    }))
    expect(factory).toHaveBeenCalledWith('conversation.content', { variant: 'embedded', phase: 'active', hero: false })
    expect(root.container.querySelector('[data-native-factory]')).not.toBeNull()
    expect(root.container.querySelector('textarea')).toBeNull()
  })
  it('retains only the copied child, binds its native scope and uses its own input machine once', async () => {
    const binding = { ctx: { child: 'child' } }
    const reference = { binding, ready: Promise.resolve(binding), release: vi.fn() }
    const retain = vi.fn().mockReturnValue(reference)
    const initialize = vi.fn()
    const submit = vi.fn()
    const facade = vi.fn().mockReturnValue({ submit })
    const services = { sessions: { refresh: vi.fn().mockResolvedValue({}), retain }, conversation: { input: { requestDraftInitialization: initialize, for: facade } } }
    const locale = { active: 'en' }
    const ctx = { get: (key: string) => services[key as keyof typeof services], locale: { getSnapshot: () => locale, subscribe: () => () => {} } } as unknown as Context
    const record: SideThread = { id: 'tab', parentId: 'parent', childId: 'child', index: 1, question: 'why?', quote: 'quoted context', closed: false }
    const threads = { subscribe: () => () => {}, version: () => 0 } as unknown as SideThreads
    const provider = vi.fn(({ children }: { session: unknown; children: ReactNode }) => createElement('div', { 'data-child-scope': '' }, children))
    const slot = vi.fn(() => createElement('div', { 'data-native-content': '' }))
    root = renderRoot(createElement(NativeSideChatPanel, { ctx, threads, record, visible: true, onNew: vi.fn(), onClose: vi.fn(), SessionProvider: provider, renderSlot: slot }))
    await act(async () => {})
    expect(retain.mock.calls[0]?.[0]).toBe('child')
    expect(provider.mock.calls.at(-1)?.[0].session).toBe(reference)
    expect(slot).toHaveBeenCalledWith(NATIVE_CONVERSATION_SLOT, {})
    expect(initialize).toHaveBeenCalledExactlyOnceWith(binding, { prompt: '> quoted context\n\nwhy?' })
    expect(facade).toHaveBeenCalledWith(binding.ctx)
    expect(submit).toHaveBeenCalledOnce()
    expect(record.question).toBe('')
    root.unmount(); root = undefined
    expect(reference.release).toHaveBeenCalledOnce()
  })
})
