import type { Agent } from '@deepseek-ai/dsh-agent'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { Context } from './context-types.ts'
import type { SidechatLogEvent, SidechatTaskState } from './sidechat-core.ts'
import { sideExportZip } from './sidechat-export.ts'
import { SidebarError } from './wire.ts'

interface Commands {
  execute(agent: Agent, line: string, attachments: readonly unknown[], signal: AbortSignal): Promise<{ result: { kind: string; text?: string } } | undefined>
  find?(agent: Agent, name: string): unknown
}
type GoalRef = { id: string; revision: number }
interface Goals {
  get(agent: Agent): SidechatTaskState['goal']
  create(agent: Agent, spec: { objective: string }): unknown
  edit(agent: Agent, ref: GoalRef, spec: { objective: string }): unknown
  pause(agent: Agent, ref: GoalRef): unknown
  resume(agent: Agent, ref: GoalRef): unknown
  clear(agent: Agent, ref: GoalRef): unknown
  disarm?(agent: Agent): unknown
}
export function createSideActions(ctx: Context, invalidate: (id: string) => void) {
  const owned = new Map<string, { agent: Agent; inheritedEventCount: number }>()
  const operations = new Map<string, AbortController>()
  const target = (id: string) => {
    const item = owned.get(id)
    if (item === undefined) throw new SidebarError('forbidden', 'Only the current temporary side chat can be changed or exported', 403)
    return item
  }
  const commands = () => ctx.get('commands') as Commands | undefined
  const goals = () => ctx.get('goals') as Goals | undefined
  const plan = (agent: Agent) => ((agent.ctx as unknown as { get?(key: string): unknown } | undefined)?.get?.('planMode') ?? ctx.get('planMode')) as { get(agent: Agent): { active: boolean; pending?: boolean } } | undefined
  const planState = (agent: Agent): SidechatTaskState['plan'] => {
    // Some preset compositions keep the controller service private, while
    // publishing its command and projection through the host registries.
    const projections = ctx.get('sessionProjections') as { stateOf(session: Agent['session'], key: string): { active: boolean; wanted?: boolean | null; running?: { wanted: boolean } | null } | undefined } | undefined
    const projected = projections?.stateOf(agent.session, 'plan')
    if (projected !== undefined) {
      const wanted = projected.running?.wanted ?? projected.wanted
      return { active: projected.active, ...(typeof wanted === 'boolean' && wanted !== projected.active ? { pending: wanted } : {}) }
    }
    const direct = plan(agent)?.get(agent)
    if (direct !== undefined) return direct
    if (commands()?.find?.(agent, 'plan') === undefined) return undefined
    // The native command can be visible across a preset boundary even when
    // its projection service is isolated. Its durable public events carry
    // the same active/wanted state used by the native projection.
    let active = false
    let wanted: boolean | undefined
    let running: { id: unknown; wanted: boolean } | undefined
    for (const event of agent.session.snapshotEvents() as unknown as readonly SidechatLogEvent[]) {
      if (event.data === null || typeof event.data !== 'object' || Array.isArray(event.data)) continue
      const data = event.data as Record<string, unknown>
      if (event.type === 'plan/mode' && typeof data.active === 'boolean') { active = data.active; wanted = undefined }
      else if (event.type === 'command/run' && data.name === 'plan' && typeof data.args === 'string') running = { id: data.commandId, wanted: data.args.trim() !== 'off' }
      else if (event.type === 'command/done' && running !== undefined && data.commandId === running.id) { wanted = data.kind === 'success' && running.wanted !== active ? running.wanted : undefined; running = undefined }
    }
    const selected = running?.wanted ?? wanted
    return { active, ...(selected === undefined || selected === active ? {} : { pending: selected }) }
  }
  const state = (id: string): SidechatTaskState => {
    const { agent } = target(id)
    const goal = goals()?.get(agent)
    const mode = planState(agent)
    return { ...(goal === undefined ? {} : { goal }), ...(mode === undefined ? {} : { plan: mode }) }
  }
  const operation = async <T>(id: string, run: (item: ReturnType<typeof target>, signal: AbortSignal) => Promise<T>): Promise<T> => {
    const item = target(id)
    if (operations.has(id)) throw new SidebarError('sidechat-error', 'Another side chat action is in progress', 409)
    const controller = new AbortController()
    operations.set(id, controller)
    try { return await run(item, controller.signal) }
    finally { operations.delete(id); invalidate(id) }
  }
  return {
    own(id: string, agent: Agent, inheritedEventCount: number) { owned.set(id, { agent, inheritedEventCount }) },
    cancel(id: string) { operations.get(id)?.abort(); const item = owned.get(id); if (item !== undefined) goals()?.disarm?.(item.agent) },
    release(id: string) { operations.get(id)?.abort(); owned.delete(id) },
    dispose() { for (const controller of operations.values()) controller.abort(); owned.clear() },
    capabilities(id: string) { const { agent } = target(id); return { compact: typeof commands()?.execute === 'function', export: true, goal: goals() !== undefined, plan: planState(agent) !== undefined && commands() !== undefined && (commands()?.find === undefined || commands()!.find!(agent, 'plan') !== undefined) } },
    state,
    goal: (id: string, action: unknown, objective: unknown, ref: unknown) => operation(id, async ({ agent }) => {
      const service = goals()
      if (service === undefined) throw new SidebarError('unavailable', 'Goals are unavailable', 503)
      if ((action === 'create' || action === 'edit') && (typeof objective !== 'string' || objective.trim() === '' || objective.length > 20_000)) throw new SidebarError('bad-request', 'Enter a goal objective (up to 20000 characters)')
      if (action === 'create') service.create(agent, { objective: (objective as string).trim() })
      else {
        if (action !== 'edit' && action !== 'pause' && action !== 'resume' && action !== 'clear') throw new SidebarError('bad-request', 'Invalid goal action')
        const current = service.get(agent)
        const observed = ref as Partial<GoalRef> | null | undefined
        if (current === undefined || observed?.id !== current.id || observed.revision !== current.revision) throw new SidebarError('sidechat-error', 'The goal changed. Reopen it and retry.', 409)
        if (action === 'edit') service.edit(agent, { id: current.id, revision: current.revision }, { objective: (objective as string).trim() })
        else service[action](agent, { id: current.id, revision: current.revision })
      }
      return state(id)
    }),
    plan: (id: string, active: unknown) => operation(id, async ({ agent }, signal) => {
      if (typeof active !== 'boolean') throw new SidebarError('bad-request', 'Invalid plan mode')
      if (planState(agent) === undefined || commands() === undefined) throw new SidebarError('unavailable', 'Plan mode is unavailable', 503)
      const result = await commands()!.execute(agent, active ? '/plan' : '/plan off', [], signal)
      if (result?.result.kind !== 'success') throw new SidebarError('sidechat-error', result?.result.text ?? 'Unable to switch plan mode', 409)
      return state(id)
    }),
    compact: (id: string) => operation(id, async ({ agent }, signal) => {
      if (agent.status !== 'idle') throw new SidebarError('sidechat-error', 'Wait for the side chat response before compacting', 409)
      const service = commands()
      if (service?.execute === undefined) throw new SidebarError('unavailable', 'Compaction is unavailable', 503)
      const execution = await service.execute(agent, '/compact', [], signal)
      if (execution === undefined) throw new SidebarError('unavailable', 'The host does not provide /compact', 503)
      if (execution.result.kind !== 'success') throw new SidebarError('sidechat-error', execution.result.text ?? 'Compaction failed', 409)
      return { text: execution.result.text ?? 'Compaction complete' }
    }),
    export: (id: string) => operation(id, async ({ agent, inheritedEventCount }, signal) => {
      const events = agent.session.snapshotEvents() as unknown as readonly SidechatLogEvent[]
      const zip = await sideExportZip(id, events, inheritedEventCount, ctx.get('attachments') as AttachmentStore | undefined, signal)
      return { fileName: `dsh-side-chat-${id}.zip`, data: Buffer.from(zip).toString('base64') }
    }),
  }
}
