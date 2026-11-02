/** Browser integration of the built artifact against a deterministic host fixture. */
/* global document, window, getSelection, MouseEvent */
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'
import { zipSync, strToU8 } from 'fflate'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(root, 'test-results', 'side-chat')
await mkdir(out, { recursive: true })
const threads = new Map()
const selections = new Map()
const catalog = { available: true, groups: [{ id: 'preview', name: 'Preview models', models: [{ id: 'fast', name: 'Fast' }, { id: 'reasoner', name: 'Reasoner', reasoning: { defaultEffort: 'high', efforts: [{ id: 'high', name: 'High' }, { id: 'low', name: 'Low' }] } }] }], failures: [] }
const calls = []
const files = {
  '/': ['tests/fixtures/preview.html', 'text/html; charset=utf-8'],
  '/react.js': ['node_modules/react/umd/react.production.min.js', 'application/javascript'],
  '/react-dom.js': ['node_modules/react-dom/umd/react-dom.production.min.js', 'application/javascript'],
  '/client.js': ['lib/client.js', 'application/javascript'],
}
function answer(id, text) {
  const events = threads.get(id)
  const append = (type, data) => events.push({ type, data, seq: events.length + 1, time: Date.now(), surfaceOp: 'append' })
  append('user/message', { content: [{ type: 'text', text }], source: { kind: 'user' }, id: crypto.randomUUID() })
  append('assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: '侧边对话继承的是打开时的上下文快照。\n\n它能读懂当前讨论的背景，包括主对话已经给出的说明，但你在这里提出的问题和收到的回复会留在这个标签页中。\n\n你可以继续追问，而主对话会继续它原来的工作。' }] } })
}
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname
    const file = files[pathname]
    if (file !== undefined) { res.writeHead(200, { 'content-type': file[1] }); res.end(await readFile(resolve(root, file[0]))); return }
    if (!pathname.startsWith('/side-chat/api/') && !pathname.startsWith('/api/delete-session/')) { res.writeHead(404); res.end(); return }
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const payload = JSON.parse(Buffer.concat(chunks).toString() || '{}')
    const method = pathname.startsWith('/side-chat/api/') ? pathname.slice('/side-chat/api/'.length) : pathname.slice('/api/'.length)
    calls.push({ method, payload })
    let value = {}
    if (method === 'sidechat.start') {
      const childId = `child-${threads.size + 1}`; threads.set(childId, [])
      if (payload.question) answer(childId, payload.question)
      value = { childId }
    } else if (method === 'sidechat.events') value = { events: (threads.get(payload.childId) ?? []).filter(event => event.seq > (payload.afterSeq ?? -1)), live: [], pending: [] }
    else if (method === 'sidechat.info') value = { live: true, status: 'idle', ...(selections.get(payload.childId) ?? { provider: 'preview', model: 'fast' }) }
    else if (method === 'sidechat.models') value = catalog
    else if (method === 'sidechat.actions') value = { compact: true, export: true, goal: true, plan: true }
    else if (method === 'sidechat.taskState') value = {}
    else if (method === 'sidechat.compact') value = { text: 'Compacted preview history.' }
    else if (method === 'sidechat.export') value = { fileName: `dsh-side-chat-${payload.childId}.zip`, data: Buffer.from(zipSync({ 'conversation.md': strToU8(payload.childId) })).toString('base64') }
    else if (method === 'sidechat.model') { const { childId, ...selection } = payload; selections.set(childId, selection); value = { accepted: true, selection } }
    else if (method === 'delete-session/preview') value = { sessionId: payload.sessionId, token: 'preview-token' }
    else if (method === 'delete-session/execute') { threads.delete(payload.sessionId); selections.delete(payload.sessionId); value = { sessionIds: [payload.sessionId] } }
    else if (method === 'sidechat.prompt') { answer(payload.childId, payload.text); value = { accepted: true } }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, value }))
  } catch (error) { res.writeHead(500); res.end(String(error)) }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
// Reuse an installed browser; override on machines with a different cache.
const executablePath = process.env.SIDE_BROWSER_PATH
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}/`)
  await page.getByRole('button', { name: '侧边对话', exact: true }).click()
  await expect(page.locator('[data-dsh-side-chat]')).toHaveCount(1)
  await expect(page.getByPlaceholder('继续追问')).toBeFocused()
  await page.getByRole('combobox', { name: '侧边对话模型' }).selectOption(JSON.stringify(['preview', 'reasoner']))
  await expect(page.getByRole('combobox', { name: '推理等级' })).toHaveValue('high')
  await page.getByRole('combobox', { name: '推理等级' }).selectOption('low')
  await page.getByPlaceholder('继续追问').fill('为什么要继承主对话上下文？')
  await page.getByPlaceholder('继续追问').press('Enter')
  await expect(page.locator('[data-dsh-side-chat]')).toContainText('它能读懂当前讨论的背景')
  await page.getByLabel('主对话输入').fill('/side 主对话还会继续吗？')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.locator('.tabs')).toContainText('侧边对话 2')
  await expect(page.getByLabel('主对话输入')).toHaveValue('')
  await expect(page.locator('[data-dsh-side-chat]').last()).toContainText('它能读懂当前讨论的背景')
  await expect(page.getByPlaceholder('继续追问').last()).toBeFocused()
  await page.evaluate(() => {
    const node = document.getElementById('selection-text'); const range = document.createRange(); range.selectNodeContents(node)
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range)
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })
  await page.getByRole('button', { name: '在侧边对话中询问' }).click()
  await page.getByPlaceholder('继续追问').last().fill('这里的“上下文”具体指什么？')
  await expect(page.getByRole('button', { name: '发送消息', exact: true }).last()).toBeEnabled()
  await page.getByPlaceholder('继续追问').last().press('Enter')
  await expect(page.locator('[data-dsh-side-chat]').last()).toContainText('它能读懂当前讨论的背景')
  expect(calls.filter(call => call.method === 'sidechat.start')).toHaveLength(3)
  expect(calls.filter(call => call.method === 'sidechat.prompt').at(-1).payload.text).toContain('> 侧边对话会继承')
  expect(await page.evaluate(() => window.registeredKinds)).toEqual(['dsh-side-chat'])
  await page.getByRole('button', { name: '添加文件或文件夹', exact: true }).last().click()
  await expect(page.getByRole('menuitem')).toHaveCount(8)
  await page.getByRole('menuitem').filter({ has: page.locator('[data-dsh-side-action="compact"]') }).click()
  await expect(page.locator('[data-dsh-side-chat]').last()).toContainText('Compacted preview history.')
  expect(calls.filter(call => call.method === 'sidechat.compact').at(-1).payload.childId).toBe('child-3')
  await page.getByRole('button', { name: '添加文件或文件夹', exact: true }).last().click()
  const download = page.waitForEvent('download')
  await page.getByRole('menuitem').filter({ has: page.locator('[data-dsh-side-action="export"]') }).click()
  expect((await download).suggestedFilename()).toBe('dsh-side-chat-child-3.zip')
  expect(calls.filter(call => call.method === 'sidechat.export').at(-1).payload.childId).toBe('child-3')
  await page.screenshot({ path: resolve(out, 'side-chat-light.png') })
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await page.screenshot({ path: resolve(out, 'side-chat-dark.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('[data-dsh-side-chat]').last()).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: resolve(out, 'side-chat-mobile.png') })
  await page.getByRole('button', { name: '关闭侧边对话', exact: true }).last().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: '删除并关闭' }).click()
  await expect(page.locator('[data-dsh-side-chat]')).toHaveCount(2)
  expect(calls.filter(call => call.method === 'sidechat.dispose')).toHaveLength(1)
  expect(calls.filter(call => call.method === 'delete-session/execute')).toHaveLength(1)
  expect(threads.size).toBe(2)
  expect(errors).toEqual([])
  console.log(JSON.stringify({ result: 'passed', screenshots: out, starts: 3, prompts: 2, browserErrors: errors.length }))
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
