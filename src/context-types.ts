/// <reference lib="esnext.disposable" preserve="true" />
/** Minimal service contracts for this standalone plugin. */
import type { Context as CordisContext } from "@deepseek-ai/cordis"

export interface SidebarHttpRequest {
  url?: string
  method?: string
  headers: Record<string, string | string[] | undefined>
  [Symbol.asyncIterator](): AsyncIterator<string | Uint8Array>
}

export interface SidebarHttpResponse {
  statusCode: number
  /** True once a status line went out; a late failure can no longer become a
   *  JSON envelope, so callers destroy the response instead. */
  headersSent?: boolean
  writeHead(status: number, headers?: Record<string, string>): void
  /** Append one body chunk; false means "wait for drain". */
  write(chunk: string | Uint8Array): boolean
  end(body?: string | Uint8Array): void
  /** Tear the connection down (mid-stream failure, client abort). */
  destroy?(error?: Error): void
}

export interface SidebarUpgradeSocket {
  destroy(): void
}

export type SidebarUpgradeHead = Uint8Array

export interface SidebarWebRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: SidebarHttpRequest, res: SidebarHttpResponse) => void | Promise<void>
}

export interface SidebarWebUpgradeRoute {
  path: string
  handler: (req: SidebarHttpRequest, socket: SidebarUpgradeSocket, head: SidebarUpgradeHead) => void | Promise<void>
}

export interface SidebarWebServer {
  register(route: SidebarWebRoute): () => void
  registerUpgrade(route: SidebarWebUpgradeRoute): () => void
}

export interface SidebarSessionHeader {
  cwd?: string
}

export interface SidebarSessionStore {
  get(id: string): {
    header: SidebarSessionHeader
    /** Live cursor and indexed reads avoid copying the whole log for cache identity. */
    readonly seq?: number
    eventAt?(seq: number): SidebarSessionEvent | undefined
    /**
     * The live session's append-only event log as an immutable snapshot.
     * Read-only access — the jobs.output route replays `job_output`
     * tool/result rows from it. (The `Session.events` property this face
     * mirrored was renamed to `snapshotEvents()` in DSH 0.1.2-alpha.4.)
     */
    snapshotEvents(): readonly SidebarSessionEvent[]
  } | undefined
}

export interface SidebarConnectionService {
  /** Public Host/Origin and authentication policy (DSH 0.2.0-rc.2+). */
  requestRejection(request: { headers: Record<string, string | string[] | undefined> }): 401 | 403 | undefined
  state: {
    getSnapshot(): 'connected' | 'disconnected' | 'connecting' | undefined
    subscribe(listener: () => void): () => void
  }
  reconnect(): void
}

export interface SidebarSlotRegisterOptions {
  name: string
  key?: string
  id?: string
  order?: number
  label?: string | (() => string)
  /** Chain routing selector (returns the matched value, or null to pass on). */
  select?: (owner: unknown) => unknown
  priority?: number
  locale?: string
  registrant?: string
  /** Business-face factory; args depend on the slot scope. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors the host slots signature, where inject args are untyped; unknown[] would reject concrete-typed implementations (contravariance)
  inject?: (...args: any[]) => Record<string, unknown>
  children?: Record<string, unknown>
}

export interface SidebarSlotsService {
  register(options: SidebarSlotRegisterOptions, component: unknown): () => void
  /**
   * Run a callback for each declaration lifetime of a slot (the runtime
   * SlotRegistry.inject): a no-op while the slot is undeclared, so the
   * settings section registration waits for the settings shell.
   */
  inject(key: string, callback: () => () => void): () => void
}

export interface SidebarSessionSummary {
  id: string
  cwd?: string
  displayTitle: string
  /** Coarse durable origin for navigation filtering (subagent children). */
  origin?: 'subagent'
  /** Durable direct parent session id (present on subagent children). */
  parentId?: string
  /** Whether the session's agent is currently running. */
  running?: boolean
}

export interface SidebarSessionEvent {
  type: string
  seq: number
  time: number
  data: Record<string, unknown>
}

export interface SidebarHistoryEntry {
  event: SidebarSessionEvent
  view?: unknown
}

export interface SidebarAgentsService {
  /** The live agent registered under a session id, or undefined when not live. */
  get(id: string): SidebarAgent | undefined
  /**
   * Create a session + agent with a custom seed (mirror of the runtime
   * AgentRegistry.create) — the Side Chat thread-creation seam: the SAME
   * public seam api-proxy's session.fork and the subagent fork provider use.
   */
  create?(options: unknown): Promise<{ agent: SidebarAgent; dispose(): Promise<void> }>
  /**
   * Resume an agent on a persisted session (mirror of the runtime
   * AgentRegistry.resume) — the Side Chat cold-continuation seam after a
   * DSH restart or a closed thread.
   */
  resume?(options: unknown): Promise<{ agent: SidebarAgent; dispose(): Promise<void> }>
}

export interface SidebarAgentPresetsService {
  /** Resolve a preset id; undefined resolves the deployment default. */
  resolve(presetId?: string): Promise<{ id: string }>
  /** Mount a preset's composition into an agent scope before publication. */
  mount(agentCtx: unknown, presetId: string): Promise<void>
}

export interface SidebarSessionTitleService {
  /** Rename one live session's title (pins it against auto-regeneration). */
  rename(session: unknown, title: string): { title: string; eventSeq: number }
}

export interface SidebarSessionPersistenceService {
  open(sessionId: string, access: 'read' | 'write'): Promise<SidebarSessionHandle>
  /**
   * Header-only snapshot of ONE stored session (revision + immutable header).
   * The cold cwd resolver reads the stored header through this: it is the one
   * persistence call that never decodes the log. Absent on a host without it —
   * every caller must degrade to a client hint.
   */
  stat?(sessionId: string): Promise<{
    /** Immutable stored header (cwd / agentPreset live here). */
    header: { cwd?: string; agentPreset?: string } & Record<string, unknown>
    /** Opaque change token of the stored artifact. */
    revision?: unknown
    /** Physical artifact size in bytes, when the backend can provide it. */
    sizeBytes?: number
  } | undefined>
}

export interface SidebarSessionHandle {
  /** Immutable stored header (cwd / agentPreset live here). */
  readonly header: { cwd?: string; agentPreset?: string } & Record<string, unknown>
  /** Exact fork-inherited prefix length stored with the log. */
  readonly inheritedEventCount?: number
  /**
   * Read a slice of the valid contiguous log.
   * @param offset - first logical seq to include (defaults to 0).
   * @param length - maximum events (defaults to the rest of the log).
   */
  read(offset?: number, length?: number): Promise<{ events: readonly SidebarSessionEvent[] }>
  /** Release the handle (idempotent). */
  close(): Promise<void>
}

export interface SidebarLocaleService {
  /** Current immutable locale snapshot (uSES-safe; `active` is 'zh' | 'en' today). */
  getSnapshot(): { active: string }
  /** Subscribe to snapshot changes (locale switch or dictionary registration). */
  subscribe(fn: () => void): () => void
  /** Register one locale's dictionary for a namespace; returns the disposer. */
  register(ns: string, locale: string, dict: Record<string, string>): () => void
}

export interface SidebarAgent {
  /** The live session identity shared with the session log. */
  readonly id: string
  /** The live session this agent drives. */
  readonly session: {
    /** The session's header (validated cwd, lineage metadata). */
    readonly header: { readonly cwd?: string }
  }
}

export interface SideChatContextShape {
  webServer: SidebarWebServer
  sessions: SidebarSessionStore
  connection: SidebarConnectionService
  slots: SidebarSlotsService
  locale: SidebarLocaleService
  agents: SidebarAgentsService
  agentPresets: SidebarAgentPresetsService
  sessionTitle: SidebarSessionTitleService
  sessionPersistence: SidebarSessionPersistenceService
  workingDirectory: { readonly defaultDirectory?: string; get(session: { header: SidebarSessionHeader }): string }
  on(event: string, listener: (session: unknown, event: SidebarSessionEvent) => void): () => void
  on(event: 'agent/assistant-stream', listener: (payload: { agent?: unknown; frame?: unknown }) => void): () => void
}
export type Context = CordisContext & SideChatContextShape
