import { Modal, Button, IconTrashOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SideCopy } from './locales.ts'
import css from './SideChatPanel.module.css'

export function CloseDialog({ copy, busy, error, cancel, confirm }: {
  copy: SideCopy; busy: boolean; error?: string; cancel(): void; confirm(): void
}): React.ReactNode {
  return <Modal open headless title={copy.closeTitle} className={css.closeDialog} onClose={() => { if (!busy) cancel() }}>
    <div className={css.closeHeading}><span className={css.closeGlyph}><IconTrashOutlineRegular size={20} /></span><h2>{copy.closeTitle}</h2></div>
    <p className={css.closeDescription}>{copy.closeDescription}</p>
    <p className={css.closeHint}>{copy.closeHint}</p>
    {error !== undefined && <p role="alert" className={css.error}>{copy.deleteFailed}: {error}</p>}
    <div className={css.closeActions}><Button variant="outline" data-modal-autofocus disabled={busy} onClick={cancel}>{copy.cancel}</Button><Button variant="primary" className={css.dangerButton} disabled={busy} onClick={confirm}>{busy ? copy.deleting : copy.deleteAndClose}</Button></div>
  </Modal>
}
