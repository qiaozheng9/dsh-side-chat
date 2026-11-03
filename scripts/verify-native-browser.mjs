/** Exercise the built plugin's native Factory binding contract, not a copied chat UI. */
/* global getSelection, MouseEvent, document */
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, expect } from '@playwright/test'
const out = resolve('test-results/native-browser')
await mkdir(out, { recursive: true })
const calls = []
const children = new Set()
let serial = 0
const files = { '/': ['tests/fixtures/native-preview.html', 'text/html'], '/client.js': ['lib/client.js', 'application/javascript'], '/react.js': ['node_modules/react/umd/react.production.min.js', 'application/javascript'], '/react-dom.js': ['node_modules/react-dom/umd/react-dom.production.min.js', 'application/javascript'] }
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname
    if (files[path]) { const [file, type] = files[path]; res.writeHead(200, { 'content-type': type }); res.end(await readFile(file)); return }
    const bytes = []; for await (const b of req) bytes.push(b)
    const payload = JSON.parse(Buffer.concat(bytes).toString() || '{}')
    calls.push({ path, payload })
    if (path === '/native/prompt') { expect(children.has(payload.id)).toBe(true); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ answer: `NATIVE_ANSWER:${payload.id}` })); return }
    let value = {}
    if (path.endsWith('/sidechat.start')) { const id = `child-${++serial}`; children.add(id); value = { childId: id } }
    else if (path.endsWith('/preview')) value = { sessionId: payload.sessionId, token: 'test-confirmed' }
    else if (path.endsWith('/execute')) { children.delete(payload.sessionId); value = { sessionIds: [payload.sessionId] } }
    else if (!path.endsWith('/sidechat.cancel') && !path.endsWith('/sidechat.dispose')) throw new Error(`Unexpected plugin operation: ${path}`)
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, value }))
  } catch (e) { res.writeHead(500); res.end(String(e)) }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ headless: true, ...(process.env.SIDE_BROWSER_PATH ? { executablePath: process.env.SIDE_BROWSER_PATH } : {}) })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto(`http://127.0.0.1:${server.address().port}/`)
  if (errors.length) throw new Error(`Native contract fixture failed: ${errors.join('; ')}`)
  const panel = () => page.locator('[data-dsh-native-side-chat]:visible')
  await page.getByRole('button', { name: '侧边对话', exact: true }).click()
  await expect(panel().locator('[data-conversation-content]')).toHaveAttribute('data-conversation-session', 'child-1')
  await panel().getByRole('textbox', { name: '原生输入' }).fill('first question')
  await panel().getByRole('button', { name: '原生发送', exact: true }).click()
  await expect(panel()).toContainText('NATIVE_ANSWER:child-1')
  await page.getByRole('textbox', { name: '主对话输入' }).fill('/side second question')
  await page.getByRole('button', { name: '主对话发送', exact: true }).click()
  await expect(panel()).toContainText('NATIVE_ANSWER:child-2')
  expect(calls.filter(c => c.path === '/native/prompt' && c.payload.id === 'child-2')).toHaveLength(1)
  await page.evaluate(() => { const node = document.getElementById('selection-text'), range = document.createRange(); range.selectNodeContents(node); const s = getSelection(); s.removeAllRanges(); s.addRange(range); node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })) })
  await page.getByRole('button', { name: '在侧边对话中询问' }).click()
  await expect(panel().getByRole('textbox', { name: '原生输入' })).toContainText('> 选中的参考文字')
  expect(calls.filter(c => c.path === '/native/prompt' && c.payload.id === 'child-3')).toHaveLength(0)
  await page.screenshot({ path: resolve(out, 'native-binding-light.png') })
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await page.screenshot({ path: resolve(out, 'native-binding-dark.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await panel().getByRole('button', { name: '关闭侧边对话', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
  await expect(panel().getByRole('textbox', { name: '原生输入' })).toContainText('选中的参考文字')
  await panel().getByRole('button', { name: '关闭侧边对话', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '删除并关闭', exact: true }).click()
  await expect(page.locator('[data-dsh-native-side-chat]')).toHaveCount(2)
  expect(children.has('child-3')).toBe(false)
  expect(children.has('child-1')).toBe(true)
  expect(children.has('child-2')).toBe(true)
  expect(calls.some(c => /sidechat\.(events|prompt|taskState)/.test(c.path))).toBe(false)
  expect(errors).toEqual([])
  console.log(JSON.stringify({ result: 'passed', independentNativeBindings: 3, pluginOwnStreaming: false, browserErrors: 0 }))
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
