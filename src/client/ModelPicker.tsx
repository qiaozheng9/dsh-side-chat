import { useEffect, useMemo, useState } from 'react'
import type { Context } from '../context-types.ts'
import type { SidechatModelCatalog, SidechatModelSelection, SidechatThreadInfo } from '../sidechat-core.ts'
import { sideApi } from './api.ts'
import type { SideCopy } from './locales.ts'
import css from './SideChatPanel.module.css'
import { nativeElement, useNativeEntry } from './native-controls.tsx'

export function ModelPicker({ ctx, info, visible, disabled, copy, onChange }: {
  ctx: Context
  info?: SidechatThreadInfo; visible: boolean; disabled: boolean; copy: SideCopy
  onChange(selection: SidechatModelSelection): Promise<void>
}): React.ReactNode {
  const [catalog, setCatalog] = useState<SidechatModelCatalog>()
  const [error, setError] = useState<string>()
  const [attempt, retry] = useState(0)
  const native = useNativeEntry(ctx, 'conversation.input.model')
  const label = useNativeEntry(ctx, 'conversation.input.model.label')
  useEffect(() => {
    if (!visible) return
    const controller = new AbortController()
    void sideApi.models(controller.signal).then(value => { setCatalog(value); setError(undefined) }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { controller.abort() }
  }, [visible, attempt])
  const provider = info?.provider ?? catalog?.default?.provider
  const model = info?.model ?? catalog?.default?.model
  const value = provider === undefined || model === undefined ? '' : JSON.stringify([provider, model])
  const current = catalog?.groups.find(group => group.id === provider)?.models.find(item => item.id === model)
  const usable = catalog?.available === true && catalog.groups.some(group => group.models.length > 0)
  const state = useMemo(() => ({
    status: catalog === undefined && error === undefined ? 'loading' : 'ready',
    groups: catalog?.groups ?? [], failures: catalog?.failures ?? [], error: error ?? null,
    current: provider === undefined || model === undefined ? null : { provider, model, ...(info?.reasoningEffort === undefined ? {} : { reasoningEffort: info.reasoningEffort }) },
    pending: null, retainedEffort: undefined,
  }), [catalog, error, provider, model, info?.reasoningEffort])
  const directory = useMemo(() => ({ getSnapshot: () => state, subscribe: () => () => {} }), [state])
  if (native !== undefined) return <div data-dsh-side-model="">{nativeElement(ctx, native, {
    locked: disabled, available: true, directory, load: () => { retry(value => value + 1) },
    select: async (selection: SidechatModelSelection) => { await onChange(selection); return { ok: true } },
    renderSlot: (_key: string, props: Record<string, unknown>, options: { fallback?: React.ReactNode }) => label === undefined ? options.fallback : nativeElement(ctx, label, props),
  })}</div>
  return <div className={css.modelControls}>
    <select aria-label={copy.model} title={copy.model} value={value} disabled={disabled || !usable} onChange={event => {
      const [nextProvider, nextModel] = JSON.parse(event.target.value) as [string, string]
      const effort = catalog?.groups.find(group => group.id === nextProvider)?.models.find(item => item.id === nextModel)?.reasoning?.defaultEffort
      void onChange({ provider: nextProvider, model: nextModel, ...(effort === undefined ? {} : { reasoningEffort: effort }) })
    }}>
      {current === undefined && <option value={value}>{model ?? (catalog === undefined && error === undefined ? copy.loadingModels : copy.inheritModel)}</option>}
      {catalog?.groups.map(group => <optgroup key={group.id} label={group.name ?? group.id}>
        {group.models.map(item => <option key={item.id} value={JSON.stringify([group.id, item.id])}>{item.name ?? item.id}</option>)}
      </optgroup>)}
    </select>
    {current?.reasoning !== undefined && current.reasoning.efforts.length > 0 && <select aria-label={copy.reasoning} title={copy.reasoning} disabled={disabled} value={info?.reasoningEffort ?? ''} onChange={event => {
      if (provider !== undefined && model !== undefined) void onChange({ provider, model, ...(event.target.value === '' ? {} : { reasoningEffort: event.target.value }) })
    }}><option value="">{copy.defaultEffort}</option>{current.reasoning.efforts.map(effort => <option key={effort.id} value={effort.id}>{effort.name ?? effort.id}</option>)}</select>}
    {(error !== undefined || (catalog !== undefined && (!usable || catalog.failures.length > 0))) && <button type="button" className={css.retry} title={error ?? catalog?.failures.map(item => item.message).join('\n') ?? copy.modelsUnavailable} onClick={() => { retry(value => value + 1) }}>{copy.retryModels}</button>}
  </div>
}
