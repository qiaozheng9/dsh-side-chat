import { useState } from 'react'
import { Button, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidechatQuestionRequest } from '../sidechat-core.ts'
import type { SideCopy } from './locales.ts'
import { markdownTextProps } from './markdown-labels.tsx'
import css from './SideChatPanel.module.css'

export function QuestionPanel({ pending, copy, answer }: { pending: SidechatQuestionRequest; copy: SideCopy; answer(value: unknown): Promise<void> }): React.ReactNode {
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [custom, setCustom] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const review = pending.questions.length === 1 && pending.questions[0]?.intent?.kind === 'plan-review' ? pending.questions[0] : undefined
  const submit = async (label?: string) => {
    setBusy(true); setError(undefined)
    try { await answer({ answers: pending.questions.map(question => ({ id: question.id, selected: label === undefined ? custom[question.id]?.trim() && !question.multiSelect ? [] : selected[question.id] ?? [] : [label], ...(custom[question.id]?.trim() ? { custom: custom[question.id]!.trim() } : {}) })) }) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false) }
  }
  const labels = { copyLabel: copy.copy, copiedLabel: copy.copied, codeLabel: copy.code, wrapLabel: copy.wrap, unwrapLabel: copy.unwrap }
  return <div className={css.questionPanel} data-dsh-side-question="" aria-label={review === undefined ? copy.questionTitle : copy.planReview}>
    <strong>{review === undefined ? copy.questionTitle : copy.planReview}</strong>
    <div className={css.questionBody}>{pending.questions.map(question => <fieldset key={question.id} disabled={busy}>
      <legend>{review === undefined ? question.question : copy.planReview}</legend>
      {question.detail !== undefined && <MarkdownText {...markdownTextProps(question.detail, labels)} />}
      {review === undefined && question.options?.map(option => <label key={option.label} className={css.questionOption}><input type={question.multiSelect ? 'checkbox' : 'radio'} name={question.id} checked={selected[question.id]?.includes(option.label) ?? false} onChange={event => { setSelected(current => ({ ...current, [question.id]: question.multiSelect ? event.target.checked ? [...(current[question.id] ?? []), option.label] : (current[question.id] ?? []).filter(value => value !== option.label) : [option.label] })) }} /><span>{option.label}{option.description && <small>{option.description}</small>}</span></label>)}
      <textarea aria-label={copy.questionCustom} placeholder={copy.questionCustom} value={custom[question.id] ?? ''} maxLength={20_000} onChange={event => { setCustom(current => ({ ...current, [question.id]: event.target.value })) }} rows={2} />
    </fieldset>)}</div>
    {error !== undefined && <p role="alert" className={css.error}>{error}</p>}
    <div className={css.questionActions}>{review !== undefined ? <>
      <Button variant="outline" disabled={busy} onClick={() => { void submit(review.options?.find(option => option.label !== review.intent?.approve)?.label) }}>{copy.planKeep}</Button>
      <Button variant="primary" disabled={busy} onClick={() => { void submit(review.intent?.approve) }}>{copy.planApprove}</Button>
    </> : <Button variant="primary" disabled={busy || pending.questions.some(question => !(selected[question.id]?.length || custom[question.id]?.trim()))} onClick={() => { void submit() }}>{copy.questionSubmit}</Button>}</div>
  </div>
}
