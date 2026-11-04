import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { FishLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context } from '../context-types.ts'
import type { SideThread, SideThreads } from './store.ts'
import { CloseDialog } from './CloseDialog.tsx'
import { sideCopy } from './locales.ts'
import css from './SideChatPanel.module.css'
import { DisplayBoundary } from './display-boundary.tsx'
import { sideApi } from './api.ts'

const ConversationActivity = createContext<{ hasConversation: boolean; mark(): void; locale: string } | undefined>(undefined)

export const NATIVE_CONVERSATION_SLOT = 'dsh-side-chat.conversation'
interface SessionReference {
  ready: Promise<unknown>
  binding: { ctx: unknown }
  release(): void
}
export interface NativeConversationHost {
  SessionProvider(props: { session: SessionReference; children: ReactNode }): ReactNode
  renderSlot(key: string, props: Record<string, unknown>): ReactNode
}
interface NativeSessions {
  refresh(): Promise<unknown>
  retain(id: string, options: { source: string; signal: AbortSignal }): SessionReference
}

/** The native Factory owns the whole transcript, editor and command menu. */
export function NativeConversation({ useSession, useConversation, renderFactorySlot }: {
  useSession<T>(selector: (session: { blank: boolean; awaitingFirstTurn: boolean; running: boolean; promptAttempted: boolean; openState: string; pendingSubmissions?: readonly unknown[] }) => T): T
  useConversation<T>(selector: (conversation: { activeTargets: ReadonlySet<string>; views?: { get(name: string): { order: readonly string[]; nodes: { get(key: string): { anchorSeq: number } | undefined } } | undefined } }) => T): T
  renderFactorySlot(name: string, props: Record<string, unknown>): ReactNode
}): ReactNode {
  const session = useSession(value => value)
  const boundary = useContext(DisplayBoundary)
  const state = useContext(ConversationActivity)
  const newRows = useConversation(value => {
    const chat = value.views?.get('chat')
    return chat?.order.some(key => (chat.nodes.get(key)?.anchorSeq ?? -1) >= (boundary ?? 0)) === true
  })
  const hasConversation = state?.hasConversation === true || newRows || session.running || (session.pendingSubmissions?.length ?? 0) > 0
  useEffect(() => { if (hasConversation) state?.mark() }, [hasConversation, state])
  const active = useConversation(value => value.activeTargets.size > 0) || (!session.blank && !session.awaitingFirstTurn) || session.running
  const hero = !active && session.openState === 'open' && !session.promptAttempted
  const copy = sideCopy(state?.locale ?? 'en')
  return <>{renderFactorySlot('conversation.content', { variant: 'embedded', phase: hero ? 'hero' : session.openState === 'loading' ? 'settling' : 'active', hero })}
    {!hasConversation && session.openState === 'open' && <div className={css.welcome} data-side-welcome="">
      <FishLogo size={58} className={css.welcomeLogo} /><h2>{copy.empty}</h2><p>{copy.hint}</p>
    </div>}</>
}

/** Only lifetime chrome belongs to this plugin. No copied chat renderer,
 * composer, event polling, approval bridge or model/command implementation. */
export function NativeSideChatPanel({ ctx, threads, record, visible, onNew, onClose, SessionProvider, renderSlot }: {
  ctx: Context; threads: SideThreads; record: SideThread; visible: boolean; onNew(): void; onClose(): void
} & NativeConversationHost): ReactNode {
  useSyncExternalStore(threads.subscribe, threads.version)
  const locale = useSyncExternalStore(listener => ctx.locale.subscribe(listener), () => ctx.locale.getSnapshot())
  const copy = sideCopy(locale.active)
  const [reference, setReference] = useState<SessionReference>()
  const [error, setError] = useState<string>()
  const [attempt, setAttempt] = useState(0)
  const [closePrompt, setClosePrompt] = useState(false)
  const [checkingClose, setCheckingClose] = useState(false)
  const checking = useRef(false)
  const panel = useRef<HTMLElement>(null)
  const childId = record.childId
  useEffect(() => {
    if (childId === undefined) return
    const sessions = ctx.get('sessions') as unknown as NativeSessions
    const abort = new AbortController()
    let retained: SessionReference | undefined
    setError(undefined)
    void sessions.refresh().then(async () => {
      abort.signal.throwIfAborted()
      retained = sessions.retain(childId, { source: 'dsh-side-chat', signal: abort.signal })
      await retained.ready
      abort.signal.throwIfAborted()
      if (record.quote !== undefined || record.question !== '') {
        const conversation = ctx.get('conversation') as { input: {
          requestDraftInitialization(binding: unknown, options: { prompt: string }): unknown
          for(scope: unknown): { submit(): void }
        } }
        const question = record.question
        const prompt = `${record.quote === undefined ? '' : `> ${record.quote.replace(/\n/g, '\n> ')}\n\n`}${question}`
        conversation.input.requestDraftInitialization(retained.binding, { prompt })
        record.quote = undefined
        record.question = ''
        if (question !== '') conversation.input.for(retained.binding.ctx).submit()
      }
      setReference(retained)
    }).catch((reason: unknown) => {
      if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { abort.abort(); retained?.release(); setReference(undefined) }
  }, [ctx, childId, record, attempt])
  useEffect(() => {
    record.requestClose = () => { void requestClose() }
    return () => { record.requestClose = undefined }
  })
  useEffect(() => {
    if (visible && reference !== undefined) panel.current?.querySelector<HTMLElement>('[data-composer-input]')?.focus()
  }, [visible, reference])
  const close = async (): Promise<void> => {
    try { await threads.close(record.id); onClose() }
    catch { /* The confirmed deletion failure is retained for retry. */ }
  }
  const requestClose = async (): Promise<void> => {
    if (checking.current || record.closed || record.closing !== undefined) return
    if (record.hasConversation) { setClosePrompt(true); return }
    checking.current = true; setCheckingClose(true); setError(undefined)
    try {
      await record.ready
      const activity = record.childId === undefined ? undefined : await sideApi.info(record.childId)
      if (activity?.hasConversation === true || record.hasConversation) { threads.markConversation(record); setClosePrompt(true) }
      else await close()
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { checking.current = false; setCheckingClose(false) }
  }
  return (
    <section ref={panel} className={css.panel} data-dsh-side-chat="" data-dsh-native-side-chat="" data-child-session={childId} aria-label={copy.title}>
      <header className={css.header}>
        <span>{copy.title}{record.index > 1 ? ` ${record.index}` : ''}</span>
        <div className={css.headerActions}>
          <button className={css.icon} type="button" aria-label={copy.newChat} disabled={record.closing !== undefined} onClick={onNew}>＋</button>
          <button className={css.icon} type="button" aria-label={copy.close} disabled={checkingClose || record.closing !== undefined} onClick={() => { void requestClose() }}>×</button>
        </div>
      </header>
      {(error ?? record.error) !== undefined && <div className={css.error} role="alert">{error ?? record.error}<button className={css.retry} type="button" onClick={() => {
        if (childId === undefined) threads.retry(record)
        else setAttempt(value => value + 1)
      }}>{copy.retry}</button></div>}
      <div className={css.nativeContent}>
        {reference === undefined ? <div className={css.empty} role="status">{copy.loadingChat}</div>
          : <DisplayBoundary.Provider value={record.displayStartSeq}><ConversationActivity.Provider value={{ hasConversation: record.hasConversation === true, mark: () => { threads.markConversation(record) }, locale: locale.active }}><SessionProvider session={reference}>{renderSlot(NATIVE_CONVERSATION_SLOT, {})}</SessionProvider></ConversationActivity.Provider></DisplayBoundary.Provider>}
      </div>
      {closePrompt && <CloseDialog copy={copy} busy={record.closing !== undefined} error={record.error} cancel={() => { setClosePrompt(false) }} confirm={() => { void close() }} />}
    </section>
  )
}
