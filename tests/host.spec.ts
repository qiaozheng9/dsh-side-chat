import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'
import type { Context, SidebarWebRoute, SidebarHttpResponse } from '../src/context-types.ts'
vi.mock('../src/assistant-live.ts', () => ({ createAssistantLiveBuffer: () => ({ dispose: vi.fn() }) }))
vi.mock('../src/sidechat-push.ts', () => ({ createSidechatPushHub: () => ({ dispose: vi.fn(), attach: vi.fn() }) }))
vi.mock('../src/sidechat-routes.ts', () => ({ buildSidechatApi: () => ({ 'sidechat.start': async (payload: unknown) => payload }) }))
const cleanup: (() => void)[] = []
afterEach(() => { while (cleanup.length > 0) cleanup.pop()!() })
function harness(rejected = false) {
  const routes: SidebarWebRoute[] = []
  const upgrades: string[] = []
  apply({
    effect: (callback: () => (() => void)) => { cleanup.push(callback()); return () => {} },
    connection: { requestRejection: () => rejected ? 'denied' : undefined },
    webServer: {
      register: (route: SidebarWebRoute) => { routes.push(route); return () => {} },
      registerUpgrade: (route: { path: string }) => { upgrades.push(route.path); return () => {} },
    },
  } as unknown as Context)
  return {
    routes, upgrades,
    async request(method: string, verb = 'POST') {
      let status = 0; let body: unknown
      const req = { method: verb, headers: {}, url: `/side-chat/api/${method}`, async *[Symbol.asyncIterator]() { yield '{"sessionId":"main"}' } }
      const res = { writeHead: (code: number) => { status = code }, end: (value: string) => { body = JSON.parse(value) } } as SidebarHttpResponse
      await routes[0]!.handler(req, res)
      return { status, body }
    },
  }
}
describe('side chat only host surface', () => {
  it('mounts only the side API and its push socket', async () => {
    const host = harness()
    expect(host.routes.map(route => route.path)).toEqual(['/side-chat/api'])
    expect(host.upgrades).toEqual(['/side-chat/ws'])
    expect(await host.request('sidechat.start')).toEqual({ status: 200, body: { ok: true, value: { sessionId: 'main' } } })
    for (const name of ['fs.write', 'fs.tree', 'git.commit', 'settings.update', 'constructor', 'toString', '../sidechat.start']) {
      expect((await host.request(name)).status).toBe(404)
    }
  })
  it('preserves host authentication and HTTP method checks', async () => {
    expect((await harness(true).request('sidechat.start')).status).toBe(403)
    expect((await harness().request('sidechat.start', 'GET')).status).toBe(405)
  })
})
