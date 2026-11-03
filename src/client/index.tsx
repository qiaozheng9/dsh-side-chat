/** Only one native tab kind and the /side and selection entry points. */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'
import type { Context } from '../context-types.ts'
import { RenderBoundary } from './RenderBoundary.tsx'
import { NativeSideChatPanel, NativeConversation, NATIVE_CONVERSATION_SLOT, type NativeConversationHost } from './NativeSideChatPanel.tsx'
import { createSideThreads, type SideThread, type SideThreads } from './store.ts'
import { sideCopy } from './locales.ts'
import { sideCommandSource } from './commands.ts'
import css from './SideChatPanel.module.css'
import { installDisplayBoundary } from './display-boundary.tsx'

export const inject = ['slots', 'sessions', 'locale']
const TYPE_ID = 'dsh-side-chat:sidechat'
interface TabInfo {
  tab: { id: string; visible: boolean; signal: AbortSignal; navigation: { params?: { sideId?: string } }; actions: { close(): void } }
}
interface SideController {
  focus(tabId: string): void
  mounted: { getSnapshot(): string | undefined }
  openTab(kind: string, options?: { params?: { sideId: string }; revealIfOpened?: boolean }): void
  openTabIn(sessionId: string, kind: string, options?: { params?: { sideId: string }; revealIfOpened?: boolean }): void
  registerCloseHandler(kind: string, handler: (sessionId: string, tab: { id: string }) => void): () => void
}
interface TabRegistry {
  register(definition: { id: string; kind: string; multiple: boolean; keepMounted: boolean; priority: string; title(): string; guide: { id: string; order: number; title(): string; description(): string }[] }): () => void
}
interface InputTriggers {
  registerSource(source: ReturnType<typeof sideCommandSource>): () => void
}
interface BodyProps extends NativeConversationHost {
  ctx: Context; sessionId: string; threads: SideThreads; bindings: Map<string, SideThread>
  useTabInfo(): TabInfo
  open(parentId: string, question?: string, quote?: string): void
}
function SideBody(props: BodyProps): React.ReactNode {
  const { ctx, sessionId, threads, bindings, open } = props
  const { tab } = props.useTabInfo()
  const key = `${sessionId}:${tab.id}`
  const [record] = useState(() => {
    const previous = bindings.get(key)
    if (previous !== undefined) return previous
    const seed = tab.navigation.params?.sideId
    const thread = (seed === undefined ? undefined : threads.get(seed)) ?? threads.create(sessionId)
    bindings.set(key, thread)
    return thread
  })
  return <RenderBoundary className={css.error}><NativeSideChatPanel ctx={ctx} threads={threads} record={record} visible={tab.visible} onNew={() => { open(sessionId) }} onClose={() => { tab.actions.close() }} SessionProvider={props.SessionProvider} renderSlot={props.renderSlot} /></RenderBoundary>
}
function SideTitle({ ctx, sessionId, threads, bindings, useTabInfo }: Pick<BodyProps, 'ctx' | 'sessionId' | 'threads' | 'bindings' | 'useTabInfo'>): React.ReactNode {
  useSyncExternalStore(threads.subscribe, threads.version)
  const { tab } = useTabInfo()
  const locale = useSyncExternalStore(listener => ctx.locale.subscribe(listener), () => ctx.locale.getSnapshot())
  const index = bindings.get(`${sessionId}:${tab.id}`)?.index ?? 1
  return <span data-dsh-side-tab={`${sessionId}:${tab.id}`}>{sideCopy(locale.active).title}{index > 1 ? ` ${index}` : ''}</span>
}
function SelectionAction({ ctx, open }: { ctx: Context; open: BodyProps['open'] }): React.ReactNode {
  const locale = useSyncExternalStore(listener => ctx.locale.subscribe(listener), () => ctx.locale.getSnapshot())
  const [selection, setSelection] = useState<{ text: string; left: number; top: number; parentId: string }>()
  useEffect(() => {
    const hide = (): void => { setSelection(undefined) }
    const selectionChanged = (): void => {
      // Browsers may dispatch selectionchange after mouseup. Preserve the
      // action for a live selection instead of immediately dismissing it.
      if (window.getSelection()?.isCollapsed !== false) hide()
    }
    const pick = (): void => {
      const selected = window.getSelection()
      const node = selected?.anchorNode?.parentElement
      const end = selected?.focusNode?.parentElement
      const surface = node?.closest('[data-slot="main.conversation"], [data-slot="conversation"]')
      const text = selected?.toString().trim()
      if (selected === null || selected.rangeCount === 0 || !text || surface == null || end == null || !surface.contains(end)
        || node?.closest('[data-dsh-side-chat], [contenteditable="true"], textarea, input') != null) { hide(); return }
      const controller = ctx.get('sidebarRight') as unknown as SideController | undefined
      const parentId = controller?.mounted.getSnapshot()
      if (parentId === undefined) { hide(); return }
      const rect = selected.getRangeAt(0).getBoundingClientRect()
      setSelection({ text, parentId, left: Math.max(8, Math.min(rect.left, window.innerWidth - 190)), top: Math.max(8, rect.top - 42) })
    }
    const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') hide() }
    document.addEventListener('mouseup', pick)
    document.addEventListener('selectionchange', selectionChanged)
    document.addEventListener('scroll', hide, true)
    document.addEventListener('keydown', key)
    window.addEventListener('blur', hide)
    window.addEventListener('resize', hide)
    return () => {
      document.removeEventListener('mouseup', pick); document.removeEventListener('selectionchange', selectionChanged)
      document.removeEventListener('scroll', hide, true); document.removeEventListener('keydown', key)
      window.removeEventListener('blur', hide); window.removeEventListener('resize', hide)
    }
  }, [ctx])
  return selection === undefined ? null : createPortal(<button type="button" className={css.selection} style={{ left: selection.left, top: selection.top }} onMouseDown={event => { event.preventDefault() }} onClick={() => {
    open(selection.parentId, '', selection.text); setSelection(undefined); window.getSelection()?.removeAllRanges()
  }}>{sideCopy(locale.active).askSelection}</button>, document.body)
}

export function apply(ctx: Context): void {
  ctx.effect(() => installDisplayBoundary(ctx.slots as unknown as Parameters<typeof installDisplayBoundary>[0]), 'sidechat: native display boundary')
  const threads = createSideThreads()
  const bindings = new Map<string, SideThread>()
  const copy = () => sideCopy(ctx.locale.getSnapshot().active)
  const open = (parentId: string, question = '', quote?: string): void => {
    const controller = ctx.get('sidebarRight') as unknown as SideController | undefined
    if (controller === undefined) throw new Error('The host right sidebar is unavailable.')
    const record = threads.create(parentId, question, quote)
    try {
      const options = { params: { sideId: record.id }, revealIfOpened: false }
      if (controller.mounted.getSnapshot() === parentId) controller.openTab('dsh-side-chat', options)
      else controller.openTabIn(parentId, 'dsh-side-chat', options)
    } catch (error) { void threads.close(record.id).catch(cleanupError => { console.error('[dsh-side] cleanup failed', cleanupError) }); throw error }
  }
  ctx.effect(() => () => { threads.dispose(); bindings.clear() }, 'sidechat: records')
  ctx.inject(['sidebarRightTabs', 'sidebarRight'], injected => {
    const tabs = injected.get('sidebarRightTabs') as unknown as TabRegistry
    const sidebar = injected.get('sidebarRight') as unknown as SideController
    injected.effect(() => {
      // Handle the native strip's close gesture before its synchronous host
      // callback. The callback below also guards non-pointer close commands.
      const closeGesture = (event: MouseEvent): void => {
        if (!(event.target instanceof Element)) return
        const tab = event.target.closest('[role="tab"]')
        const marker = tab?.querySelector<HTMLElement>('[data-dsh-side-tab]')
        if (marker === null || marker === undefined) return
        const button = event.target.closest('button')
        if (event.type === 'click' && (button === null || button === tab || button.getAttribute('role') === 'tab')) return
        if (event.type === 'auxclick' && event.button !== 1) return
        const record = bindings.get(marker.dataset.dshSideTab ?? '')
        if (record === undefined || record.closed) return
        event.preventDefault(); event.stopImmediatePropagation()
        sidebar.focus(tab!.getAttribute('data-tab-id') ?? marker.dataset.dshSideTab!.slice(record.parentId.length + 1))
        record.requestClose?.()
      }
      document.addEventListener('click', closeGesture, true)
      document.addEventListener('auxclick', closeGesture, true)
      return () => { document.removeEventListener('click', closeGesture, true); document.removeEventListener('auxclick', closeGesture, true) }
    }, 'sidechat: native close confirmation')
    injected.effect(() => {
      const disposers: (() => void)[] = []
      const release = (): void => {
        for (const dispose of disposers.splice(0).reverse()) {
          try { dispose() } catch (error) { console.error('[dsh-side] native cleanup failed', error) }
        }
      }
      try {
      disposers.push(tabs.register({
      id: TYPE_ID, kind: 'dsh-side-chat', multiple: true, keepMounted: true, priority: 'extension', title: () => copy().title,
      guide: [{ id: 'dsh-side-chat', order: 10, title: () => copy().title, description: () => copy().description }],
    }))
    disposers.push(sidebar.registerCloseHandler('dsh-side-chat', (sessionId, tab) => {
      const key = `${sessionId}:${tab.id}`
      const record = bindings.get(key)
      if (record !== undefined && !record.closed) {
        sidebar.focus(tab.id)
        record.requestClose?.()
        // The host's cleanup hook is synchronous. Refuse removal until the
        // panel has confirmed AND completed the asynchronous deletion.
        throw new Error('Side chat close is awaiting confirmation and deletion')
      }
      bindings.delete(key)
    }))
    disposers.push(ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
      name: 'sidebar.right.pane.tab', key: TYPE_ID,
      children: { [NATIVE_CONVERSATION_SLOT]: { kind: 'single', scope: 'session' } },
      inject: (sessionId: string) => ({ ctx, sessionId, threads, bindings, open }),
    }, SideBody)))
    disposers.push(ctx.slots.inject(NATIVE_CONVERSATION_SLOT, () => ctx.slots.register({ name: NATIVE_CONVERSATION_SLOT }, NativeConversation)))
    disposers.push(ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
      name: 'sidebar.right.pane.tab.title', key: TYPE_ID,
      inject: (sessionId: string) => ({ ctx, sessionId, threads, bindings }),
    }, SideTitle)))
    disposers.push(ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
      name: 'conversation.input.left', id: 'dsh-side:open', order: 90,
      inject: (sessionId: string) => ({ ctx, sessionId }),
    }, ({ sessionId }: { sessionId: string }) => <button type="button" className={css.icon} title={copy().description} aria-label={copy().title} onClick={() => { open(sessionId) }}>
      <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><rect x="2.5" y="3" width="15" height="14" rx="3"/><path d="M11.5 3v14M5.5 7h3M5.5 10h3"/></svg>
    </button>)))
      } catch (error) { release(); throw error }
      return release
    }, 'sidechat: native registrations')
    injected.effect(() => {
      const node = document.createElement('div')
      node.setAttribute('data-dsh-side-selection', '')
      document.body.appendChild(node)
      const root = createRoot(node)
      root.render(<SelectionAction ctx={ctx} open={open} />)
      return () => { root.unmount(); node.remove() }
    }, 'sidechat: selection')
  })
  ctx.inject(['inputTriggers'], injected => {
    const triggers = injected.get('inputTriggers') as unknown as InputTriggers
    injected.effect(() => triggers.registerSource(sideCommandSource(open, copy)), 'sidechat: /side')
  })
}
