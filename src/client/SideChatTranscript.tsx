import { useState } from 'react'
import { DisclosureRow, IconThinkOutlineRegular, IconChevronDownOutlineRegular, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { markdownTextProps } from './markdown-labels.tsx'
import { sidechatRowKey, toolArgsSummary, type SidechatTranscriptRow } from './sidechat-transcript.ts'
import type { SideCopy } from './locales.ts'
import css from './SideChatPanel.module.css'

type Summary = Extract<SidechatTranscriptRow, { kind: 'turnSummary' }>

/** Use the same whole-second duration and units as the native Turn header. */
function duration(ms: number, copy: SideCopy): string {
  const total = Math.max(1, Math.floor(ms / 1000))
  return `${total >= 3600 ? `${Math.floor(total / 3600)}${copy.hourUnit}` : ''}${total >= 60 ? `${Math.floor(total / 60) % 60}${copy.minuteUnit}` : ''}${total % 60}${copy.secondUnit}`
}

function Message({ row, copy, active = false }: { row: SidechatTranscriptRow; copy: SideCopy; active?: boolean }): React.ReactNode {
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)
  const labels = { copyLabel: copy.copy, copiedLabel: copy.copied, codeLabel: copy.code, wrapLabel: copy.wrap, unwrapLabel: copy.unwrap }
  if (row.kind === 'injection' || row.kind === 'turnSummary') return null
  if (row.kind === 'reasoning') return (
    <div className={css.reasoning} data-side-reasoning-state={active ? 'running' : 'done'}>
      <DisclosureRow icon={<IconThinkOutlineRegular size={14} />} title={active ? copy.analyzing : copy.analysisDone}
        open={open} expandable expandOnRowClick running={active} onToggle={() => { setOpen(value => !value) }}>
        {open && <div className={css.reasoningBody}><MarkdownText {...markdownTextProps(row.text, labels)} streaming={active} variant="compact" /></div>}
      </DisclosureRow>
    </div>
  )
  if (row.kind === 'tool') return (
    <details className={css.disclosure} data-side-tool-state={row.failed ? 'error' : active ? 'running' : 'done'}>
      <summary>{row.failed ? copy.toolFailed : active ? copy.callingTools : copy.toolsDone} · {row.name} {row.args === undefined ? '' : toolArgsSummary(row.args)}</summary>
      <pre>{row.resultText ?? row.args}</pre>
    </details>
  )
  if (row.kind === 'deliverables') return <div className={css.disclosure}>{row.files.map(file => <div key={file.path}>{file.path}</div>)}</div>
  if (row.kind === 'error') return <div role="alert" className={css.error}>{row.text}</div>
  if (row.kind === 'user') return <div className={css.user}><MarkdownText {...markdownTextProps(row.text, labels)} /></div>
  return (
    <div className={css.assistant}>
      <MarkdownText {...markdownTextProps(row.text, labels)} streaming={!row.settled && active} />
      {row.settled && <button type="button" className={css.copy} aria-label={copy.copy} onClick={() => {
        void navigator.clipboard.writeText(row.text).then(() => { setCopied(true) }).catch(() => {})
      }}>{copied ? copy.copied : copy.copy}</button>}
    </div>
  )
}

/** Keep process disclosures above the final answer, as in the main chat. */
function Turn({ rows, summary, running, copy }: { rows: SidechatTranscriptRow[]; summary?: Summary; running: boolean; copy: SideCopy }): React.ReactNode {
  const [expanded, setExpanded] = useState(true)
  const firstContent = rows.findIndex(row => row.kind !== 'user' && row.kind !== 'injection')
  const before = firstContent < 0 ? rows : rows.slice(0, firstContent)
  const content = firstContent < 0 ? [] : rows.slice(firstContent)
  const lastProcess = content.findLastIndex(row => row.kind === 'reasoning' || row.kind === 'tool')
  // Only process before a final answer may fold. Interleaved user messages,
  // stopped turns, and failures remain visible, matching the native policy.
  const canFold = summary !== undefined && summary.outcome === undefined && lastProcess >= 0
    && content.slice(lastProcess + 1).some(row => row.kind === 'assistant')
    && !content.some(row => row.kind === 'user' || row.kind === 'error')
  const label = summary?.outcome === 'stopped' ? copy.stopped : summary?.outcome === 'error' ? copy.failed
    : summary?.durationMs === undefined ? copy.completed : `${copy.completedIn}${duration(summary.durationMs, copy)}`
  const render = (row: SidechatTranscriptRow, index: number): React.ReactNode => {
    const following = rows.slice(index + 1)
    const active = running && summary === undefined && (row.kind === 'reasoning'
      ? !row.settled && !following.some(item => item.kind === 'assistant' || item.kind === 'tool')
      : row.kind === 'tool' ? row.executing === true : row.kind === 'assistant' && !row.settled)
    return <Message key={sidechatRowKey(row)} row={row} copy={copy} active={active} />
  }
  return (
    <>
      {before.map(render)}
      {summary !== undefined && <button type="button" className={css.turnSummary} data-side-turn-state={summary.outcome ?? 'completed'}
        disabled={!canFold} aria-expanded={canFold ? expanded : undefined} onClick={() => { setExpanded(value => !value) }}>
        <span>{label}</span>{canFold && <IconChevronDownOutlineRegular size={14} className={expanded ? css.expandedChevron : undefined} />}
      </button>}
      {content.map((row, index) => canFold && !expanded && index <= lastProcess ? null : render(row, before.length + index))}
    </>
  )
}

export function SideChatTranscript({ rows, running, copy }: { rows: SidechatTranscriptRow[]; running: boolean; copy: SideCopy }): React.ReactNode {
  const turns: Array<{ key: string; rows: SidechatTranscriptRow[]; summary?: Summary }> = []
  let pending: SidechatTranscriptRow[] = []
  for (const row of rows) {
    if (row.kind === 'injection') continue
    if (row.kind === 'turnSummary') {
      turns.push({ key: String(pending[0]?.seq ?? row.seq), rows: pending, summary: row })
      pending = []
    } else pending.push(row)
  }
  if (pending.length > 0) turns.push({ key: String(pending[0]!.seq), rows: pending })
  return turns.map(turn => <Turn key={turn.key} rows={turn.rows} {...(turn.summary === undefined ? {} : { summary: turn.summary })} running={running} copy={copy} />)
}

/** Derive the live label from this turn, never from a completed earlier one. */
export function responseActivity(rows: readonly SidechatTranscriptRow[], waitingApproval: boolean, waitingAnswer: boolean): 'waitingApproval' | 'questionTitle' | 'analyzing' | 'replying' | 'callingTools' | 'processing' {
  if (waitingApproval) return 'waitingApproval'
  if (waitingAnswer) return 'questionTitle'
  const start = rows.findLastIndex(row => row.kind === 'turnSummary') + 1
  const current = rows.slice(start)
  if (current.some(row => row.kind === 'tool' && row.executing)) return 'callingTools'
  const latest = current.findLast(row => row.kind === 'assistant' || row.kind === 'reasoning')
  if (latest?.kind === 'assistant') return latest.settled ? 'processing' : 'replying'
  return 'analyzing'
}
