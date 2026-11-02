import { createElement, useSyncExternalStore, type ComponentType, type ReactNode } from 'react'
import type { Context } from '../context-types.ts'

/** Consume the host's public slot ledger without copying its components or
 * changing its registrations. Business operations remain child-session bound. */
export interface NativeEntry {
  component: ComponentType<Record<string, unknown>>
  locale?: string
}
interface NativeSlots {
  entries?(key: string): readonly NativeEntry[]
  entriesOfSlot?(key: string): readonly NativeEntry[]
  subscribe?(key: string, listener: () => void): () => void
}
const EMPTY: readonly NativeEntry[] = []
export function useNativeEntry(ctx: Context, key: string, locale?: string): NativeEntry | undefined {
  const slots = ctx.slots as unknown as NativeSlots | undefined
  useSyncExternalStore(listener => slots?.subscribe?.(key, listener) ?? (() => {}), () => slots?.entries?.(key) ?? EMPTY)
  const entries = slots?.entriesOfSlot?.(key) ?? slots?.entries?.(key) ?? EMPTY
  return locale === undefined ? entries[0] : entries.find(entry => entry.locale === locale)
}
export function nativeTranslate(ctx: Context, entry: NativeEntry): unknown {
  const locale = ctx.locale as unknown as { bind?(namespace: string): unknown }
  return entry.locale === undefined ? undefined : locale.bind?.(entry.locale)
}
export function nativeElement(ctx: Context, entry: NativeEntry, props: Record<string, unknown>): ReactNode {
  return createElement(entry.component, { ...props, t: nativeTranslate(ctx, entry) })
}
