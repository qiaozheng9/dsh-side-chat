// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react'
import { act } from 'react-dom/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeConversation, NativeSideChatPanel, NATIVE_CONVERSATION_SLOT } from '../src/client/NativeSideChatPanel.tsx'
import type { Context } from '../src/context-types.ts'
import type { SideThread, SideThreads } from '../src/client/store.ts'
import { renderRoot, setupReactAct, type RenderedRoot } from './test-utils.ts'

vi.mock('../src/client/CloseDialog.tsx', () => ({ CloseDialog: () => null }))
setupReactAct()
let root: RenderedRoot | undefined
afterEach(() => { root?.unmount(); root = undefined })

describe('native conversation embedding', () => {
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
