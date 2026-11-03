/** Side-chat-only host. No filesystem, Git, task, terminal or settings routes. */
import type { Context } from './context-types.ts'
import { buildNativeSidechatApi } from './native-sidechat.ts'
import { readJsonBody, SidebarError, writeError, writeJson, writeOk } from './wire.ts'

export const name = 'dsh-side-chat'
export const inject = ['webServer', 'sessions', 'sessionPersistence', 'connection']

export function apply(ctx: Context): void {
  const api = buildNativeSidechatApi(ctx)
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/side-chat/api',
    handler: async (req, res) => {
      if (ctx.connection.requestRejection(req) !== undefined) {
        writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
        return
      }
      if (req.method !== 'POST') {
        writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
        return
      }
      try {
        const method = new URL(req.url ?? '/', 'http://dsh.internal').pathname.slice('/side-chat/api/'.length)
        if (!Object.hasOwn(api, method)) throw new SidebarError('not-found', 'unknown side chat method', 404)
        const handler = api[method as keyof typeof api] as (payload: unknown) => Promise<unknown>
        writeOk(res, await handler(await readJsonBody(req, method === 'sidechat.prompt' ? 24 << 20 : undefined)))
      } catch (error) {
        writeError(res, error)
      }
    },
  }), 'sidechat: API')
}
