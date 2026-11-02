/** Side-chat-only host. No filesystem, Git, task, terminal or settings routes. */
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer } from 'ws'
import type { Context } from './context-types.ts'
import { createAssistantLiveBuffer } from './assistant-live.ts'
import { buildSidechatApi } from './sidechat-routes.ts'
import { createSidechatPushHub } from './sidechat-push.ts'
import { readJsonBody, SidebarError, writeError, writeJson, writeOk } from './wire.ts'

export const name = 'dsh-side-chat'
export const inject = ['webServer', 'sessions', 'connection']

export function apply(ctx: Context): void {
  const live = createAssistantLiveBuffer(ctx)
  const push = createSidechatPushHub(ctx)
  const api = buildSidechatApi(ctx, live, id => { push.invalidate(id) })
  const wss = new WebSocketServer({ noServer: true })
  ctx.effect(() => () => {
    live.dispose()
    push.dispose()
    for (const socket of wss.clients) socket.terminate()
    wss.close()
  }, 'sidechat: release streams')
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
  ctx.effect(() => ctx.webServer.registerUpgrade({
    path: '/side-chat/ws',
    handler: (req, socket, head) => {
      if (ctx.connection.requestRejection(req) !== undefined) { socket.destroy(); return }
      wss.handleUpgrade(req as unknown as IncomingMessage, socket as unknown as Duplex, head as Buffer, ws => push.attach(ws))
    },
  }), 'sidechat: push')
}
