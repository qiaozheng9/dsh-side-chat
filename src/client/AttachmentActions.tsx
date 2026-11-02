import { useRef, useState } from 'react'
import { Menu, IconPaperclipOutlineRegular, IconFolderCloseRegular, IconGoalOutlineRegular, IconPlanOutlineRegular, IconCompactOutlineRegular, IconDatabaseOutlineRegular, PermissionIconFullAccessRegular, IconDownloadOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidechatAttachment } from '../sidechat-core.ts'
import type { SideCopy } from './locales.ts'
import css from './SideChatPanel.module.css'

export interface DraftAttachment { id: string; name: string; file?: File; path?: string }
function hostPath(file: File): string | undefined {
  const host = window as unknown as { __DSH_HOST_PATHS__?: { pathFor(file: File): string } }
  return host.__DSH_HOST_PATHS__?.pathFor(file) || undefined
}
export function encodeAttachments(files: readonly DraftAttachment[]): Promise<SidechatAttachment[]> {
  return Promise.all(files.filter((item): item is DraftAttachment & { file: File } => item.file !== undefined).map(item => new Promise<SidechatAttachment>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => { reject(reader.error ?? new Error('Unable to read attachment')) }
    reader.onload = () => { resolve({ name: item.name, data: String(reader.result).split(',')[1]!, ...(item.file.type === '' ? {} : { mediaType: item.file.type }) }) }
    reader.readAsDataURL(item.file)
  })))
}
export type SideMenuAction = 'model' | 'permission' | 'compact' | 'export' | 'goal' | 'plan'
export function AttachmentActions({ disabled, copy, add, onError, onAction, controlsLocked = false, compactEnabled = false, exportEnabled = false, goalEnabled = false, planEnabled = false, planActive = false }: {
  disabled: boolean; copy: SideCopy; add(files: DraftAttachment[]): void; onError(reason: unknown): void
  onAction?(action: SideMenuAction): void; controlsLocked?: boolean; compactEnabled?: boolean; exportEnabled?: boolean
  goalEnabled?: boolean; planEnabled?: boolean; planActive?: boolean
}): React.ReactNode {
  const [open, setOpen] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [width, setWidth] = useState(360)
  const label = (id: string, name: string, alias: string, description: string, Icon: (props: { size: number }) => React.ReactNode): React.ReactNode => <span className={css.menuRow} style={{ width: width - 24 }} data-dsh-side-action={id}>
    <span className={css.menuIcon} aria-hidden="true"><Icon size={14} /></span><span className={css.menuName}>{name}</span>{alias !== '' && <span className={css.menuAlias}>{alias}</span>}<span className={css.menuDescription}>{description}</span>
  </span>
  const directory = useRef<HTMLInputElement | null>(null)
  const pickFolder = async (): Promise<void> => {
    const host = window as unknown as { __DSH_DIRECTORY_PICKER__?: { pick(): Promise<string | null> } }
    if (host.__DSH_DIRECTORY_PICKER__ === undefined) { directory.current?.click(); return }
    try {
      const path = await host.__DSH_DIRECTORY_PICKER__.pick()
      if (path !== null && path !== '') add([{ id: crypto.randomUUID(), path, name: path.replaceAll('\\', '/').replace(/\/$/, '').split('/').at(-1) ?? path }])
    } catch (error) { onError(error) }
  }
  const intake = (files: FileList | null, folder: boolean): void => {
    if (files === null || files.length === 0) return
    try {
      if (folder) {
        const first = files[0]!
        const absolute = hostPath(first)?.replaceAll('\\', '/')
        const relative = first.webkitRelativePath
        if (absolute === undefined || relative === '') throw new Error(copy.folderDesktopOnly)
        const path = absolute.slice(0, -relative.length) + relative.split('/')[0]!
        add([{ id: crypto.randomUUID(), path, name: relative.split('/')[0]! }])
      } else {
        add([...files].map(file => {
          const path = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) ? undefined : hostPath(file)
          if (path === undefined && file.size > 8 * 1024 * 1024) throw new Error(copy.fileTooLarge)
          return { id: crypto.randomUUID(), name: file.name, ...(path === undefined ? { file } : { path }) }
        }))
      }
    } catch (error) { onError(error) }
  }
  return <>
    <input type="file" hidden multiple ref={picker} data-dsh-side-files="" onChange={event => { intake(event.target.files, false); event.target.value = '' }} />
    <input type="file" hidden multiple ref={element => { directory.current = element; element?.setAttribute('webkitdirectory', '') }} data-dsh-side-folder="" onChange={event => { intake(event.target.files, true); event.target.value = '' }} />
    <Menu open={open} side="top" portal dense listClassName={css.actionMenu} getAnchorRect={() => trigger.current?.closest('form')?.getBoundingClientRect() ?? trigger.current?.getBoundingClientRect() ?? null} onClose={() => { setOpen(false) }} items={[
      { type: 'label', id: 'add', text: copy.addGroup },
      { id: 'file', label: label('file', copy.fileAction, 'file', copy.fileDescription, IconPaperclipOutlineRegular) },
      { id: 'folder', label: label('folder', copy.folderAction, 'folder', copy.folderDescription, IconFolderCloseRegular) },
      { id: 'goal', label: label('goal', copy.goalAction, 'goal', copy.goalDescription, IconGoalOutlineRegular), disabled: !goalEnabled || onAction === undefined },
      { id: 'plan', label: label('plan', copy.planAction, 'plan', planActive ? copy.planOff : copy.planDescription, IconPlanOutlineRegular), disabled: !planEnabled || controlsLocked || onAction === undefined },
      { type: 'separator', id: 'separator' }, { type: 'label', id: 'commands', text: copy.commandGroup },
      { id: 'compact', label: label('compact', copy.compactAction, 'compact', copy.compactDescription, IconCompactOutlineRegular), disabled: !compactEnabled || onAction === undefined },
      { id: 'permission', label: label('permission', copy.permissionAction, 'permission', copy.permissionDescription, PermissionIconFullAccessRegular), disabled: controlsLocked || onAction === undefined },
      { id: 'model', label: label('model', copy.modelAction, 'model', copy.modelDescription, IconDatabaseOutlineRegular), disabled: controlsLocked || onAction === undefined },
      { id: 'export', label: label('export', copy.exportAction, '', copy.exportDescription, IconDownloadOutlineRegular), disabled: !exportEnabled || onAction === undefined },
    ]} onSelect={id => {
      setOpen(false)
      if (id === 'file') picker.current?.click()
      else if (id === 'folder') void pickFolder()
      else if (id === 'model' || id === 'permission' || id === 'compact' || id === 'export' || id === 'goal' || id === 'plan') {
        window.requestAnimationFrame(() => { onAction?.(id) })
      }
    }} anchor={<button ref={trigger} type="button" className={css.add} aria-label={copy.addFilesMenu} disabled={disabled} onClick={() => { setWidth(Math.min(trigger.current?.closest('form')?.getBoundingClientRect().width || 360, window.innerWidth - 24)); setOpen(value => !value) }}><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M8 2.5v11M2.5 8h11" /></svg></button>} />
  </>
}
