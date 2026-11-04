import type { CommandClaim, PickOutcome } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SideCopy } from './locales.ts'

interface Session { sessionId: string }
export function sideQuestion(line: string): string | undefined {
  const match = /^\/side(?:\s+([\s\S]*))?$/.exec(line.trim())
  return match === null ? undefined : (match[1] ?? '').trim()
}

/** Register through the host input pipeline, so Send, Enter and command chips agree. */
export function sideCommandSource(open: (sessionId: string, question?: string) => void, copy: () => SideCopy, available: (id: string) => boolean = () => true, subscribe?: (listener: () => void) => () => void) {
  const claim = (session: Session): CommandClaim => ({
    name: 'side', token: '/side ', hint: copy().description, attachments: false,
    submit: async args => {
      if (!available(session.sessionId)) return { kind: 'error', text: copy().contextRequired }
      try { open(session.sessionId, args.trim()); return { kind: 'success' } }
      catch (error) { return { kind: 'error', text: error instanceof Error ? error.message : String(error) } }
    },
  })
  return {
    trigger: '/' as const, name: 'dsh-side-chat', order: -10, showGroupTitle: false,
    lexicon: (session?: Session) => session !== undefined && available(session.sessionId) ? ['side'] : [],
    ...(subscribe === undefined ? {} : { subscribeLexicon: (_session: Session, listener: () => void) => subscribe(listener) }),
    candidates: async (session: Session, req: { query: string; position: string }) =>
      available(session.sessionId) && req.position === 'leading' && 'side'.startsWith(req.query.toLowerCase())
        ? [{ name: 'side', label: copy().title, description: copy().description }] : [],
    onPick: ({ session }: { session: Session }): PickOutcome => { if (!available(session.sessionId)) return undefined; open(session.sessionId); return { text: '' } },
    matchSpace: (session: Session, token: string): PickOutcome => available(session.sessionId) && token === '/side' ? { claim: claim(session) } : undefined,
    matchClaim: async (session: Session, token: string): Promise<CommandClaim | undefined> => available(session.sessionId) && token.trim() === '/side' ? claim(session) : undefined,
    matchEnter: async (session: Session, line: string, signal: AbortSignal, envelope: { attachments: number }): Promise<PickOutcome> => {
      const question = sideQuestion(line)
      if (question === undefined || signal.aborted) return undefined
      if (!available(session.sessionId)) throw new Error(copy().contextRequired)
      if (envelope.attachments > 0) throw new Error('/side accepts text only. Remove attachments before opening a side chat.')
      // A claim lets the host commit its draft only after submit succeeds.
      // Returning 'handled' would leave /side in the main composer.
      return { claim: claim(session) }
    },
  }
}
