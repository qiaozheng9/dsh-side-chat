// @vitest-environment jsdom
import { createElement } from 'react'
import { act } from 'react-dom/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SideChatPanel } from '../src/client/SideChatPanel.tsx'
import { sideApi } from '../src/client/api.ts'
import { createSideThreads } from '../src/client/store.ts'
import type { Context } from '../src/context-types.ts'
import { renderRoot, setupReactAct, type RenderedRoot } from './test-utils.ts'
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  MarkdownText: ({ text }: { text: string }) => createElement('p', null, text),
  IconSendOutlineRegular: () => createElement('span', null, '↑'),
  IconStopFillRegular: () => createElement('span', null, '■'),
  ...Object.fromEntries(['IconPaperclipOutlineRegular', 'IconFolderCloseRegular', 'IconGoalOutlineRegular', 'IconPlanOutlineRegular', 'IconCompactOutlineRegular', 'IconDatabaseOutlineRegular', 'PermissionIconFullAccessRegular', 'IconDownloadOutlineRegular', 'IconTrashOutlineRegular'].map(name => [name, () => createElement('svg')])),
  Modal: ({ open, children, title, footer }: { open: boolean; children: React.ReactNode; title: string; footer?: React.ReactNode }) => open ? createElement('div', { role: 'dialog', 'aria-label': title }, children, footer) : null,
  Button: ({ children, variant: _variant, size: _size, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => createElement('button', props, children),
  Menu: ({ anchor }: { anchor: React.ReactNode }) => anchor,
}))
vi.mock('../src/client/use-sidechat-push.ts', () => ({ useSidechatPush: vi.fn() }))
vi.mock('../src/client/api.ts', () => ({ sideApi: {
  start: vi.fn(), dispose: vi.fn().mockResolvedValue({}), info: vi.fn(), events: vi.fn(),
  prompt: vi.fn(), cancel: vi.fn().mockResolvedValue({}), dequeue: vi.fn().mockResolvedValue({}),
  models: vi.fn(), model: vi.fn(),
  permissions: vi.fn(), permission: vi.fn(), approval: vi.fn(),
  actions: vi.fn(), compact: vi.fn(), export: vi.fn(), taskState: vi.fn(), goal: vi.fn(), plan: vi.fn(), question: vi.fn(),
} }))
setupReactAct()
const locale = { active: 'en' }
const ctx = { locale: { subscribe: () => () => {}, getSnapshot: () => locale } } as unknown as Context
let root: RenderedRoot | undefined
beforeEach(() => {
  vi.mocked(sideApi.start).mockResolvedValue({ childId: 'child' })
  vi.mocked(sideApi.events).mockResolvedValue({ events: [], live: [], pending: [] })
  vi.mocked(sideApi.info).mockResolvedValue({ live: true, status: 'idle' })
  vi.mocked(sideApi.prompt).mockResolvedValue({})
  vi.mocked(sideApi.permissions).mockResolvedValue({ available: false, catalog: { options: [] } })
  vi.mocked(sideApi.actions).mockResolvedValue({ compact: true, export: true, goal: true, plan: true })
  vi.mocked(sideApi.taskState).mockResolvedValue({})
  vi.mocked(sideApi.models).mockResolvedValue({ available: true, groups: [{ id: 'p', name: 'Provider', models: [
    { id: 'first', name: 'First model' }, { id: 'second', name: 'Second model', reasoning: { defaultEffort: 'high', efforts: [{ id: 'high', name: 'High' }, { id: 'low', name: 'Low' }] } },
  ] }], failures: [] })
  vi.mocked(sideApi.model).mockResolvedValue({ accepted: true, selection: { provider: 'p', model: 'second', reasoningEffort: 'high' } })
})
afterEach(() => { root?.unmount(); root = undefined; vi.restoreAllMocks(); vi.clearAllMocks() })
async function mount(quote?: string) {
  const threads = createSideThreads()
  const record = threads.create('main', '', quote)
  await record.ready
  const onClose = vi.fn()
  const props = { ctx, threads, record, visible: true, onNew: vi.fn(), onClose }
  root = renderRoot(createElement(SideChatPanel, props))
  await act(async () => {})
  return { props, onClose, threads, record }
}
function type(text: string): HTMLTextAreaElement {
  const textarea = root!.container.querySelector('textarea')!
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, text)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
  return textarea
}
describe('side chat composer and lifecycle', () => {
  it('confirms before discarding an unsent draft', async () => {
    const { onClose } = await mount()
    type('keep my draft')
    act(() => { (root!.container.querySelector('[aria-label="Close side chat"]') as HTMLButtonElement).click() })
    expect(root!.container.querySelector('[role="dialog"]')).not.toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })
  it('confirms while a message is sending before any durable user row exists', async () => {
    vi.mocked(sideApi.prompt).mockImplementation(() => new Promise(() => {}))
    const { onClose } = await mount()
    type('in flight')
    act(() => { root!.container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    act(() => { (root!.container.querySelector('[aria-label="Close side chat"]') as HTMLButtonElement).click() })
    expect(root!.container.querySelector('[role="dialog"]')).not.toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })
  it('sends quoted context only to the child, while IME Enter and Shift+Enter do not submit', async () => {
    await mount('chosen\npassage')
    const textarea = type('why?')
    act(() => { textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })) })
    act(() => { textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })) })
    expect(sideApi.prompt).not.toHaveBeenCalled()
    await act(async () => { textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(sideApi.prompt).toHaveBeenCalledExactlyOnceWith('child', '> chosen\n> passage\n\nwhy?')
    expect(textarea.value).toBe('')
  })
  it('preserves a failed message and its quote for retry', async () => {
    vi.mocked(sideApi.prompt).mockRejectedValueOnce(new Error('offline'))
    await mount('context')
    type('keep this')
    await act(async () => { root!.container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(root!.container.querySelector('textarea')!.value).toBe('keep this')
    expect(root!.container.textContent).toContain('offline')
    expect(root!.container.textContent).toContain('context')
  })
  it('does not poll while idle and clears the fallback timer when hidden', async () => {
    const interval = vi.spyOn(window, 'setInterval')
    const clear = vi.spyOn(window, 'clearInterval')
    const { props } = await mount()
    expect(interval).not.toHaveBeenCalled()
    root!.unmount(); root = undefined
    vi.mocked(sideApi.info).mockResolvedValue({ live: true, status: 'running' })
    root = renderRoot(createElement(SideChatPanel, props))
    await act(async () => {})
    expect(interval).toHaveBeenCalledTimes(1)
    root.rerender(createElement(SideChatPanel, { ...props, visible: false }))
    expect(clear).toHaveBeenCalledTimes(1)
  })
  it('cancels the side thread and confirms closing a conversation', async () => {
    vi.mocked(sideApi.info).mockResolvedValue({ live: true, status: 'running' })
    vi.mocked(sideApi.events).mockResolvedValue({ live: [], pending: [], events: [
      { type: 'user/message', seq: 1, time: 1, data: { content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } } },
    ] })
    const { onClose } = await mount()
    await act(async () => { (root!.container.querySelector('[aria-label="Stop response"]') as HTMLButtonElement).click() })
    expect(sideApi.cancel).toHaveBeenCalledExactlyOnceWith('child')
    act(() => { (root!.container.querySelector('[aria-label="Close side chat"]') as HTMLButtonElement).click() })
    expect(root!.container.querySelector('[role="dialog"]')).not.toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => { const buttons = root!.container.querySelectorAll('[role="dialog"] button'); (buttons[buttons.length - 1] as HTMLButtonElement).click() })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
  it('changes only the child model and its reasoning effort', async () => {
    vi.mocked(sideApi.info).mockResolvedValue({ live: true, status: 'idle', provider: 'p', model: 'first' })
    await mount()
    vi.mocked(sideApi.info).mockResolvedValue({ live: true, status: 'idle', provider: 'p', model: 'second', reasoningEffort: 'high' })
    const select = root!.container.querySelector<HTMLSelectElement>('[aria-label="Side chat model"]')!
    await act(async () => { select.value = JSON.stringify(['p', 'second']); select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(sideApi.model).toHaveBeenCalledExactlyOnceWith('child', { provider: 'p', model: 'second', reasoningEffort: 'high' })
    const effort = root!.container.querySelector<HTMLSelectElement>('[aria-label="Reasoning effort"]')!
    await act(async () => { effort.value = 'low'; effort.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(sideApi.model).toHaveBeenLastCalledWith('child', { provider: 'p', model: 'second', reasoningEffort: 'low' })
    expect(sideApi.prompt).not.toHaveBeenCalled()
  })
  it('always confirms even an empty chat and retains it if deletion fails', async () => {
    vi.mocked(sideApi.dispose).mockRejectedValueOnce(new Error('storage busy'))
    const { onClose, record, threads } = await mount()
    act(() => { (root!.container.querySelector('[aria-label="Close side chat"]') as HTMLButtonElement).click() })
    expect(root!.container.querySelector('[role="dialog"]')?.textContent).toContain('permanently deletes')
    await act(async () => { const buttons = root!.container.querySelectorAll('[role="dialog"] button'); (buttons[buttons.length - 1] as HTMLButtonElement).click() })
    expect(onClose).not.toHaveBeenCalled()
    expect(threads.get(record.id)).toBe(record)
    expect(root!.container.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain('storage busy')
    await act(async () => { const buttons = root!.container.querySelectorAll('[role="dialog"] button'); (buttons[buttons.length - 1] as HTMLButtonElement).click() })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(threads.get(record.id)).toBeUndefined()
  })
})
