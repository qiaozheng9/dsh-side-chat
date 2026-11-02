import { useEffect, useState } from 'react'
import type { Context } from '../context-types.ts'
import type { SidechatPermissions } from '../sidechat-core.ts'
import { sideApi } from './api.ts'
import { nativeElement, useNativeEntry } from './native-controls.tsx'
import type { SideCopy } from './locales.ts'

export function PermissionPicker({ ctx, childId, currentValue, visible, disabled, copy, onChanged, onError }: {
  ctx: Context; childId?: string; currentValue?: string; visible: boolean; disabled: boolean; copy: SideCopy
  onChanged(): Promise<void>; onError(reason: unknown): void
}): React.ReactNode {
  const native = useNativeEntry(ctx, 'conversation.input.permission')
  const [value, setValue] = useState<SidechatPermissions>()
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!visible || childId === undefined) return
    const controller = new AbortController()
    void sideApi.permissions(childId, controller.signal).then(setValue).catch((error: unknown) => { if (!controller.signal.aborted) onError(error) })
    return () => { controller.abort() }
  }, [childId, visible, onError])
  if (value?.available !== true) return null
  const selected = currentValue ?? value.currentValue
  const select = async (preset: string): Promise<void> => {
    if (childId === undefined) return
    setBusy(true)
    try { setValue(await sideApi.permission(childId, preset)); await onChanged() }
    catch (error) { onError(error); throw error }
    finally { setBusy(false) }
  }
  if (native !== undefined) return <div data-dsh-side-permission="">{nativeElement(ctx, native, {
    locked: disabled || busy, select,
    usePermissionCatalog: (selector: (state: { value: SidechatPermissions['catalog'] }) => unknown) => selector({ value: value.catalog }),
    useProjection: () => ({ currentValue: selected }),
  })}</div>
  return <select aria-label={copy.permissions} value={selected} disabled={disabled || busy} onChange={event => {
    const preset = event.target.value
    if ((preset === 'danger-full-access' || preset === 'auto') && !window.confirm(copy.permissionConfirm)) return
    void select(preset).catch(() => {})
  }}>{value.catalog.options.map(option => <option key={option.value} value={option.value}>{option.name}</option>)}</select>
}
