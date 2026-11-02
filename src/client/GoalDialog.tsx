import { useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidechatTaskState } from '../sidechat-core.ts'
import { sideApi } from './api.ts'
import type { SideCopy } from './locales.ts'
import css from './SideChatPanel.module.css'

export function GoalDialog({ childId, state, copy, cancel, changed }: {
  childId: string; state: SidechatTaskState; copy: SideCopy; cancel(): void; changed(state: SidechatTaskState): void
}): React.ReactNode {
  const goal = state.goal
  const [objective, setObjective] = useState(goal?.objective ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const run = async (action: string) => {
    setBusy(true); setError(undefined)
    try { const next = await sideApi.goal(childId, action, objective, goal === undefined ? undefined : { id: goal.id, revision: goal.revision }); changed(next); cancel() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const phase = goal === undefined ? undefined : ({ active: copy.goalActive, paused: copy.goalPaused, blocked: copy.goalBlocked, complete: copy.goalComplete })[goal.phase]
  return <Modal open title={copy.goalTitle} closeLabel={copy.cancel} onClose={() => { if (!busy) cancel() }} className={css.goalDialog} footer={<>
    <Button variant="outline" disabled={busy} onClick={cancel}>{copy.cancel}</Button>
    <Button variant="primary" disabled={busy || objective.trim() === ''} onClick={() => { void run(goal === undefined || goal.phase === 'complete' ? 'create' : 'edit') }}>{busy ? copy.goalWorking : goal === undefined || goal.phase === 'complete' ? copy.goalCreate : copy.goalSave}</Button>
  </>}>
    {goal === undefined ? <p className={css.goalHint}>{copy.goalEmpty}</p> : <div className={css.goalState}><span>{phase}</span><span>{goal.roundsStarted ?? 0} / {goal.maxGoalRounds ?? '—'}</span></div>}
    <label className={css.goalField}>{copy.goalObjective}<textarea data-modal-autofocus aria-label={copy.goalObjective} value={objective} disabled={busy} placeholder={copy.goalPlaceholder} maxLength={20_000} onChange={event => { setObjective(event.target.value) }} rows={4} /></label>
    {goal !== undefined && <div className={css.goalControls}>
      {goal.phase !== 'complete' && <Button variant="outline" size="sm" disabled={busy} onClick={() => { void run(goal.phase === 'active' && goal.activation === 'armed' ? 'pause' : 'resume') }}>{goal.phase === 'active' && goal.activation === 'armed' ? copy.goalPause : copy.goalResume}</Button>}
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => { void run('clear') }}>{copy.goalClear}</Button>
    </div>}
    {error !== undefined && <p role="alert" className={css.error}>{error}</p>}
  </Modal>
}
