import { randomUUID } from 'node:crypto'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SidechatQuestionRequest } from './sidechat-core.ts'
import { SidebarError } from './wire.ts'

interface Answer { answers: { id: string; selected: string[]; custom?: string }[] }
interface Request { agent?: Agent; questions: SidechatQuestionRequest['questions']; signal?: AbortSignal }
/** An answer channel for side-owned plan reviews and clarification questions. */
export function createSideQuestions(invalidate: (id: string) => void) {
  const installed = new WeakSet<Agent>()
  const pending = new Map<string, { childId: string; view: SidechatQuestionRequest; finish(answer?: Answer): void }>()
  const aborted = () => Object.assign(new Error('Side chat question cancelled'), { code: 'ASK_ABORTED' })
  return {
    install(agent: Agent) {
      if (installed.has(agent)) return
      installed.add(agent)
      // Cordis event is owned by the optional native user-questions package.
      const context = agent.ctx as unknown as { on(name: string, handler: (request: Request, next: () => unknown) => unknown, options: { prepend: boolean }): unknown }
      context.on('user-questions/request', (request, next) => {
        if (request.agent !== agent) return next()
        if (request.signal?.aborted) return Promise.reject(aborted())
        return new Promise<Answer>((resolve, reject) => {
          const id = randomUUID()
          const cancel = () => finish()
          const finish = (answer?: Answer) => {
            if (!pending.delete(id)) return
            request.signal?.removeEventListener('abort', cancel)
            invalidate(agent.id)
            if (answer === undefined) reject(aborted()); else resolve(answer)
          }
          pending.set(id, { childId: agent.id, view: { id, questions: request.questions }, finish })
          request.signal?.addEventListener('abort', cancel, { once: true })
          invalidate(agent.id)
        })
      }, { prepend: true })
    },
    list(id: string) { return [...pending.values()].filter(item => item.childId === id).map(item => item.view) },
    answer(childId: string, id: string, raw: unknown) {
      const item = pending.get(id)
      if (item === undefined || item.childId !== childId) throw new SidebarError('not-found', 'Question is no longer pending', 404)
      const answer = raw as Answer | null
      if (!Array.isArray(answer?.answers) || answer.answers.length !== item.view.questions.length) throw new SidebarError('bad-request', 'Answer each question')
      const clean: Answer = { answers: item.view.questions.map(question => {
        const responses = answer.answers.filter(value => value?.id === question.id)
        const value = responses[0]
        if (responses.length !== 1 || value === undefined || !Array.isArray(value.selected) || value.selected.some(label => typeof label !== 'string' || !question.options?.some(option => option.label === label))
          || new Set(value.selected).size !== value.selected.length || (!question.multiSelect && value.selected.length > 1)
          || (value.custom !== undefined && (typeof value.custom !== 'string' || value.custom.length > 20_000))) throw new SidebarError('bad-request', 'Invalid question answer')
        return { id: question.id, selected: [...value.selected], ...(value.custom === undefined ? {} : { custom: value.custom }) }
      }) }
      item.finish(clean)
    },
    release(id: string) { for (const item of [...pending.values()]) if (item.childId === id) item.finish() },
    dispose() { for (const item of [...pending.values()]) item.finish() },
  }
}
