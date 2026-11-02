import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { IconSendOutlineRegular, IconStopFillRegular, MarkdownText, IconGoalOutlineRegular, IconPlanOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { CloseDialog } from './CloseDialog.tsx'
import { GoalDialog } from './GoalDialog.tsx'
import { QuestionPanel } from './QuestionPanel.tsx'
import type { SidechatTaskState } from '../sidechat-core.ts'
import type { Context, SidebarHistoryEntry, SidebarSessionEvent } from '../context-types.ts'
import type { SidechatLogEvent, SidechatPendingInput, SidechatThreadInfo, SidechatModelSelection } from '../sidechat-core.ts'
import { markdownTextProps } from './markdown-labels.tsx'
import { transcriptRows, toolArgsSummary, type SidechatTranscriptRow } from './sidechat-transcript.ts'
import { useSidechatPush } from './use-sidechat-push.ts'
import { sideApi } from './api.ts'
import { ModelPicker } from './ModelPicker.tsx'
import { PermissionPicker } from './PermissionPicker.tsx'
import { ApprovalPanel } from './ApprovalPanel.tsx'
import { AttachmentActions, encodeAttachments, type DraftAttachment, type SideMenuAction } from './AttachmentActions.tsx'
import { sideCopy, type SideCopy } from './locales.ts'
import type { SideThread, SideThreads } from './store.ts'
import css from './SideChatPanel.module.css'

function Message({ row, copy }: { row: SidechatTranscriptRow; copy: SideCopy }): React.ReactNode {
  const [copied, setCopied] = useState(false)
  const labels = { copyLabel: copy.copy, copiedLabel: copy.copied, codeLabel: copy.code, wrapLabel: copy.wrap, unwrapLabel: copy.unwrap }
  if (row.kind === 'injection' || row.kind === 'turnSummary') return null
  if (row.kind === 'reasoning') return <details className={css.disclosure}><summary>{copy.thinking}</summary><div>{row.text}</div></details>
  if (row.kind === 'tool') return (
    <details className={css.disclosure}>
      <summary>{row.name} {row.args === undefined ? '' : toolArgsSummary(row.args)}</summary>
      <pre>{row.resultText ?? row.args}</pre>
    </details>
  )
  if (row.kind === 'deliverables') return <div className={css.disclosure}>{row.files.map(file => <div key={file.path}>{file.path}</div>)}</div>
  if (row.kind === 'error') return <div role="alert" className={css.error}>{row.text}</div>
  if (row.kind === 'user') return <div className={css.user}><MarkdownText {...markdownTextProps(row.text, labels)} /></div>
  return (
    <div className={css.assistant}>
      <MarkdownText {...markdownTextProps(row.text, labels)} />
      {row.settled && <button type="button" className={css.copy} aria-label={copy.copy} onClick={() => {
        void navigator.clipboard.writeText(row.text).then(() => { setCopied(true) }).catch(() => {})
      }}>{copied ? copy.copied : copy.copy}</button>}
    </div>
  )
}

/** One controller record per native tab; hidden bodies hold no timers or sockets. */
export function SideChatPanel({ ctx, threads, record, visible, onNew, onClose }: {
  ctx: Context; threads: SideThreads; record: SideThread; visible: boolean; onNew(): void; onClose(): void
}): React.ReactNode {
  useSyncExternalStore(threads.subscribe, threads.version)
  const locale = useSyncExternalStore(listener => ctx.locale.subscribe(listener), () => ctx.locale.getSnapshot())
  const copy = sideCopy(locale.active)
  const [draft, setDraft] = useState('')
  const [quote, setQuote] = useState(record.quote)
  const [rows, setRows] = useState<SidechatTranscriptRow[]>([])
  const [pending, setPending] = useState<SidechatPendingInput[]>([])
  const [echo, setEcho] = useState<string>()
  const [running, setRunning] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string>()
  const [closePrompt, setClosePrompt] = useState(false)
  const [info, setInfo] = useState<SidechatThreadInfo>()
  const [modelSaving, setModelSaving] = useState(false)
  const [files, setFiles] = useState<DraftAttachment[]>([])
  const [fontFamily, setFontFamily] = useState<string>()
  const [capabilities, setCapabilities] = useState({ compact: false, export: false, goal: false, plan: false })
  const [task, setTask] = useState<SidechatTaskState>({})
  const [goalOpen, setGoalOpen] = useState(false)
  const [actionBusy, setActionBusy] = useState<SideMenuAction>()
  const [notice, setNotice] = useState<string>()
  const panel = useRef<HTMLElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const events = useRef<SidechatLogEvent[]>([])
  const flight = useRef<Promise<void> | undefined>(undefined)
  const invalidated = useRef(false)
  const latestRefresh = useRef<() => Promise<void>>(() => Promise.resolve())
  const abort = useRef<AbortController | undefined>(undefined)
  const childId = record.childId
  const showError = useCallback((reason: unknown) => { setError(reason instanceof Error ? reason.message : String(reason)) }, [])
  useEffect(() => {
    if (!visible || childId === undefined) return
    const controller = new AbortController()
    void sideApi.actions(childId, controller.signal).then(setCapabilities).catch((error: unknown) => { if (!controller.signal.aborted) showError(error) })
    return () => { controller.abort() }
  }, [childId, visible, showError])
  useEffect(() => {
    if (!visible) return
    const editor = document.querySelector<HTMLElement>('[data-slot="conversation.composer.bar"] [contenteditable="true"]')
    if (editor !== null) setFontFamily(getComputedStyle(editor).fontFamily)
  }, [visible])
  const refresh = useCallback((): Promise<void> => {
    if (childId === undefined) return Promise.resolve()
    if (flight.current !== undefined) { invalidated.current = true; return flight.current }
    const controller = new AbortController()
    abort.current = controller
    const request = Promise.all([sideApi.events(childId, events.current.at(-1)?.seq, controller.signal), sideApi.info(childId, controller.signal), sideApi.taskState(childId, controller.signal)])
      .then(([feed, info, task]) => {
        if (controller.signal.aborted) return
        const merged = new Map(events.current.map(event => [event.seq, event]))
        for (const event of feed.events) merged.set(event.seq, event)
        events.current = [...merged.values()].sort((a, b) => a.seq - b.seq)
        const entries: SidebarHistoryEntry[] = [...events.current, ...feed.live].map(event => ({ event: event as SidebarSessionEvent }))
        const nextRows = transcriptRows(entries)
        setRows(nextRows)
        const known = new Set(nextRows.flatMap(row => row.kind === 'user' && row.messageId !== undefined ? [row.messageId] : []))
        setPending(feed.pending.filter(item => !known.has(item.id)))
        setEcho(current => current !== undefined && (feed.pending.some(item => item.text === current) || nextRows.some(row => row.kind === 'user' && row.text === current)) ? undefined : current)
        setRunning(info.status === 'running' || feed.live.length > 0 || feed.pending.length > 0)
        setInfo(info)
        setTask(task)
        setError(undefined)
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
      }).finally(() => {
        if (flight.current !== request) return
        flight.current = undefined
        if (invalidated.current && !controller.signal.aborted) {
          invalidated.current = false
          void latestRefresh.current()
        }
      })
    flight.current = request
    return request
  }, [childId])
  latestRefresh.current = refresh
  const watched = useMemo(() => childId === undefined ? [] : [childId], [childId])
  useSidechatPush({ threadIds: watched, visible, onInvalidate: () => { void refresh() } })
  useEffect(() => {
    if (!visible || childId === undefined) return
    void refresh()
    input.current?.focus()
    return () => { abort.current?.abort(); flight.current = undefined }
  }, [childId, visible, refresh])
  useEffect(() => {
    if (!visible || childId === undefined || (!running && error === undefined && echo === undefined)) return
    const timer = window.setInterval(() => { void refresh() }, 15_000)
    return () => { window.clearInterval(timer) }
  }, [childId, visible, running, error, echo, refresh])
  useEffect(() => {
    if (pinned.current && scroll.current !== null) scroll.current.scrollTop = scroll.current.scrollHeight
  }, [rows, pending, echo, running])
  useEffect(() => {
    if (input.current === null) return
    input.current.style.height = 'auto'
    input.current.style.height = `${Math.min(input.current.scrollHeight, 180)}px`
  }, [draft])
  const requestClose = useCallback(() => { setClosePrompt(true) }, [])
  useEffect(() => {
    record.requestClose = requestClose
    return () => { if (record.requestClose === requestClose) record.requestClose = undefined }
  }, [record, requestClose])
  const closing = record.closing !== undefined
  const selectModel = async (selection: SidechatModelSelection): Promise<void> => {
    if (childId === undefined || modelSaving || closing || running || sending) return
    setModelSaving(true); setError(undefined)
    try {
      const result = await sideApi.model(childId, selection)
      setInfo(current => ({ ...current, live: true, ...result.selection }))
      await refresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setModelSaving(false) }
  }
  const send = async (): Promise<void> => {
    const text = draft.trim()
    if ((text === '' && files.length === 0) || childId === undefined || sending || modelSaving || closing || actionBusy !== undefined) return
    const fileNames = files.length === 0 ? '' : `\n\n${files.map(item => item.path ?? item.name).join('\n')}`
    const question = text + fileNames
    const outgoing = quote === undefined ? question : `> ${quote.replace(/\n/g, '\n> ')}\n\n${question}`
    setSending(true); setEcho(outgoing); setError(undefined); setNotice(undefined)
    try {
      const encoded = await encodeAttachments(files)
      if (encoded.length === 0) await sideApi.prompt(childId, outgoing)
      else await sideApi.prompt(childId, outgoing, encoded)
      setDraft(''); setQuote(undefined); setFiles([]); setRunning(true); pinned.current = true
      await refresh()
    } catch (reason) {
      setEcho(undefined)
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally { setSending(false); input.current?.focus() }
  }
  const close = async (): Promise<void> => {
    try { await threads.close(record.id); onClose() }
    catch { /* The record retains the deletion failure and can be retried. */ }
  }
  const runAction = async (action: SideMenuAction): Promise<void> => {
    if (childId === undefined || actionBusy !== undefined || closing) return
    if (action === 'goal') { setGoalOpen(true); return }
    if (action === 'model' || action === 'permission') {
      const selector = action === 'model' ? '[data-dsh-side-model] button,select[aria-label="' + copy.model + '"]'
        : '[data-dsh-side-permission] button,select[aria-label="' + copy.permissions + '"]'
      const control = panel.current?.querySelector<HTMLButtonElement | HTMLSelectElement>(selector)
      if (control === null || control === undefined || control.disabled) { showError(copy.controlsUnavailable); return }
      control.focus()
      if (control instanceof HTMLSelectElement) { try { control.showPicker() } catch { /* retain keyboard focus */ } }
      else control.click()
      return
    }
    setActionBusy(action); setError(undefined); setNotice(undefined)
    try {
      if (action === 'plan') {
        const next = await sideApi.plan(childId, !(task.plan?.pending ?? task.plan?.active ?? false))
        setTask(next); await refresh()
        setNotice(next.plan?.pending ?? next.plan?.active ? copy.planEnabled : copy.planDisabled)
      } else if (action === 'compact') {
        const result = await sideApi.compact(childId)
        events.current = []
        await refresh()
        setNotice(`${copy.compactDone} ${result.text}`)
      } else {
        const result = await sideApi.export(childId)
        const bytes = Uint8Array.from(atob(result.data), char => char.charCodeAt(0))
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }))
        const link = document.createElement('a')
        link.href = url; link.download = result.fileName
        document.body.appendChild(link); link.click(); link.remove()
        window.setTimeout(() => { URL.revokeObjectURL(url) }, 10_000)
        setNotice(copy.exportDone)
      }
    } catch (error) { showError(error) }
    finally { setActionBusy(undefined) }
  }
  return (
    <section ref={panel} className={css.panel} style={fontFamily === undefined ? undefined : { fontFamily }} data-dsh-side-chat="" aria-label={copy.title}>
      <header className={css.header}>
        <span>{copy.title}{record.index > 1 ? ` ${record.index}` : ''}</span>
        <div className={css.headerActions}>
          <button type="button" disabled={closing} className={css.icon} onClick={onNew} title={copy.newChat} aria-label={copy.newChat}>＋</button>
          <button type="button" disabled={closing} className={css.icon} title={copy.close} aria-label={copy.close} onClick={requestClose}>×</button>
        </div>
      </header>
      <div className={css.scroll} ref={scroll} onScroll={() => {
        const node = scroll.current
        if (node !== null) pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 64
      }} role="log" aria-label={copy.title} aria-busy={running}>
        {rows.length === 0 && echo === undefined && pending.length === 0 && (
          <div className={css.empty}>
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M4 4h16v12H9l-5 4V4Z"/><path d="M8 8h8M8 12h5"/></svg>
            <h2>{copy.empty}</h2><p>{copy.hint}</p>
          </div>
        )}
        {rows.map((row, index) => <Message key={`${row.kind}:${row.seq}:${'contentBlockIndex' in row ? row.contentBlockIndex : index}`} row={row} copy={copy} />)}
        {pending.map(item => <div className={css.user} key={item.id}>{item.text}<div className={css.pending}>{copy.queue}<button type="button" className={css.icon} aria-label={copy.removeQueued} onClick={() => {
          if (childId !== undefined) void sideApi.dequeue(childId, item.id).then(refresh).catch(reason => { setError(String(reason)) })
        }}>×</button></div></div>)}
        {echo !== undefined && <div className={css.user}>{echo}<div className={css.pending}>{copy.queue}</div></div>}
        {running && <div className={css.thinking} role="status"><span className={css.dot} />{info?.approvals?.length ? copy.waitingApproval : copy.thinking}</div>}
      </div>
      {(notice !== undefined || actionBusy !== undefined) && <div className={css.notice} role="status">{actionBusy === 'compact' ? copy.compacting : actionBusy === 'export' ? copy.exporting : actionBusy === 'plan' ? copy.planOn : notice}</div>}
      {(error ?? record.error) !== undefined && <div className={css.error} role="alert">{error ?? record.error}<button type="button" className={css.retry} onClick={() => {
        if (record.childId === undefined) threads.retry(record)
        else void refresh()
      }}>{copy.retry}</button></div>}
      {(task.goal !== undefined || task.plan?.active || task.plan?.pending) && <div className={css.taskBar}>
        {task.goal !== undefined && <button type="button" onClick={() => { setGoalOpen(true) }} title={task.goal.objective}><IconGoalOutlineRegular size={14} /><span>{task.goal.objective}</span><small>{({ active: copy.goalActive, paused: copy.goalPaused, blocked: copy.goalBlocked, complete: copy.goalComplete })[task.goal.phase]}</small></button>}
        {(task.plan?.pending ?? task.plan?.active) && <span className={css.planBadge}><IconPlanOutlineRegular size={14} />{copy.planOn}</span>}
      </div>}
      {info?.questions?.[0] !== undefined ? <QuestionPanel key={info.questions[0].id} pending={info.questions[0]} copy={copy} answer={async value => {
        try { await sideApi.question(childId!, info.questions![0]!.id, value); await refresh() }
        catch (error) { showError(error); throw error }
      }} /> : info?.approvals?.[0] !== undefined ? <ApprovalPanel ctx={ctx} pending={info.approvals[0]} copy={copy} answer={async outcome => {
        try { await sideApi.approval(childId!, info.approvals![0]!.id, outcome); await refresh() }
        catch (error) { showError(error); throw error }
      }} /> : <form className={css.composer} onSubmit={event => { event.preventDefault(); void send() }}>
        {quote !== undefined && <div className={css.quote}><span>{quote}</span><button type="button" className={css.icon} aria-label={copy.removeQuote} onClick={() => { setQuote(undefined) }}>×</button></div>}
        {files.length > 0 && <div className={css.attachments}>{files.map(file => <span className={css.attachment} key={file.id}>{file.name}<button type="button" aria-label={`${copy.removeAttachment} ${file.name}`} disabled={sending || closing} onClick={() => { setFiles(current => current.filter(item => item.id !== file.id)) }}>×</button></span>)}</div>}
        <textarea ref={input} disabled={closing || actionBusy !== undefined} value={draft} rows={1} placeholder={copy.placeholder} aria-label={copy.placeholder} onChange={event => { setDraft(event.target.value) }} onPaste={event => {
          if (event.clipboardData.files.length === 0) return
          event.preventDefault()
          const added = [...event.clipboardData.files].map(file => ({ id: crypto.randomUUID(), name: file.name, file }))
          if (files.length + added.length > 10 || added.some(item => item.file.size > 8 * 1024 * 1024)
            || [...files, ...added].reduce((sum, item) => sum + (item.file?.size ?? 0), 0) > 16 * 1024 * 1024) { showError(copy.fileTooLarge); return }
          setFiles(current => [...current, ...added])
        }} onKeyDown={event => {
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return
          event.preventDefault(); void send()
        }} />
        <div className={css.toolbar}><div className={css.composerDetails}><AttachmentActions disabled={childId === undefined || closing || sending || actionBusy !== undefined} copy={copy} onError={showError} onAction={action => { void runAction(action) }} controlsLocked={running || sending || modelSaving} compactEnabled={capabilities.compact && !running && !sending} exportEnabled={capabilities.export} goalEnabled={capabilities.goal} planEnabled={capabilities.plan} planActive={task.plan?.pending ?? task.plan?.active ?? false} add={added => {
          if (files.length + added.length > 10) { showError(copy.tooManyFiles); return }
          if ([...files, ...added].reduce((sum, item) => sum + (item.file?.size ?? 0), 0) > 16 * 1024 * 1024) { showError(copy.fileTooLarge); return }
          setFiles(current => [...current, ...added])
        }} /><PermissionPicker ctx={ctx} childId={childId} currentValue={info?.permissionPreset} visible={visible} disabled={closing || sending || running || actionBusy !== undefined} copy={copy} onChanged={refresh} onError={showError} /></div>
        <div className={css.trailing}><ModelPicker ctx={ctx} info={info} visible={visible} disabled={childId === undefined || modelSaving || closing || running || sending || actionBusy !== undefined} copy={copy} onChange={selectModel} />
          {(running || actionBusy !== undefined) && draft.trim() === '' && files.length === 0 ? <button type="button" className={css.send} aria-label={copy.stop} onClick={() => {
            if (childId !== undefined) void sideApi.cancel(childId).then(refresh).catch(reason => { setError(String(reason)) })
          }}><IconStopFillRegular size={18} /></button> : <button type="submit" className={css.send} disabled={(draft.trim() === '' && files.length === 0) || childId === undefined || sending || modelSaving || closing || actionBusy !== undefined} aria-label={copy.send}><IconSendOutlineRegular size={18} /></button>}
        </div></div>
      </form>}
      {goalOpen && childId !== undefined && <GoalDialog childId={childId} state={task} copy={copy} cancel={() => { setGoalOpen(false) }} changed={next => { setTask(next); void refresh() }} />}
      {closePrompt && <CloseDialog copy={copy} busy={closing} {...(record.error === undefined ? {} : { error: record.error })} cancel={() => { setClosePrompt(false); input.current?.focus() }} confirm={() => { void close() }} />}
    </section>
  )
}
