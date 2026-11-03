/** Opt-in installed verification. --new creates a dedicated synthetic parent. */
import { readFile, writeFile, readdir, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { chromium, expect } from '@playwright/test'

const out = resolve('test-results/installed')
const stateFile = join(out, 'native-boundary-0.2.1.json')
const port = (await readFile('C:/Users/QiaoZheng/AppData/Roaming/@deepseek-ai/dsh-desktop/DevToolsActivePort', 'utf8')).split(/\r?\n/)[0]
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('dsh-app://app/'))
const report = process.argv.includes('--new') ? { version: '0.2.1', checks: {}, replies: [] } : JSON.parse(await readFile(stateFile, 'utf8'))
const save = () => writeFile(stateFile, JSON.stringify(report, null, 2))
const panel = () => page.locator('[data-dsh-native-side-chat]:visible').last()
const mainBar = () => page.locator('[data-slot="main.conversation"] [data-slot="conversation.composer.bar"]').first()
const editor = () => panel().locator('[data-composer-input]')
const allRequests = []
const errors = []
page.on('pageerror', e => errors.push(e.message))
page.on('request', r => { if (r.url().includes('/side-chat/')) allRequests.push(new URL(r.url()).pathname) })
const hash = async path => createHash('sha256').update(await readFile(path)).digest('hex')
async function settledHash(path) {
  let previous, stable = 0
  for (let i = 0; i < 30; i++) {
    const current = await hash(path)
    stable = current === previous ? stable + 1 : 0; previous = current
    if (stable >= 6) return current
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error('Synthetic parent storage did not settle before isolation baseline')
}
async function sessionFile(id) {
  const root = 'C:/Users/QiaoZheng/.dsh/sessions'
  for (const group of await readdir(root, { withFileTypes: true })) {
    if (!group.isDirectory()) continue
    const path = join(root, group.name, id, 'session.v4.jsonl.zstd')
    try { await access(path); return path } catch { /* inspect this exact synthetic identity only */ }
  }
  throw new Error('Synthetic session file unavailable')
}
async function api(method, childId) {
  return page.evaluate(async ({ method, childId }) => {
    const result = await (await fetch(`/side-chat/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ childId }) })).json()
    if (!result.ok) throw new Error(result.error?.message)
    return result.value
  }, { method, childId })
}
async function idle(id) {
  await expect.poll(async () => (await api('sidechat.info', id)).status, { timeout: 180_000 }).toBe('idle')
  await expect(panel().getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0, { timeout: 15_000 })
}
async function side(question = '') {
  const response = page.waitForResponse(r => r.url().endsWith('/side-chat/api/sidechat.start'))
  const input = mainBar().locator('[data-composer-input]')
  await input.fill(`/side${question ? ` ${question}` : ''}`); await input.press('Enter')
  const r = await response
  expect(r.request().postDataJSON().sessionId).toBe(report.parentId)
  const body = await r.json(); if (!body.ok) throw new Error(body.error?.message)
  const id = body.value.childId
  report.created = [...(report.created ?? []), id]; await save()
  await expect(panel().locator('[data-conversation-content]')).toHaveAttribute('data-conversation-session', id, { timeout: 30_000 })
  await expect(editor()).toBeEditable({ timeout: 30_000 })
  return id
}
async function capture(file) {
  const clip = await panel().boundingBox()
  const cdp = await page.context().newCDPSession(page)
  try { const image = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, clip: { ...clip, scale: 1 } }); await writeFile(join(out, file), Buffer.from(image.data, 'base64')) }
  finally { await cdp.detach() }
}
try {
  if (process.argv.includes('--new')) {
    await page.getByRole('button', { name: '新建会话', exact: true }).first().click()
    await expect(page.locator('[data-conversation-content]').first()).toHaveAttribute('data-content-phase', 'hero')
    expect(await mainBar().locator('[data-composer-input]').innerText()).toBe('')
    report.parentId = await page.locator('[data-conversation-content]').first().getAttribute('data-conversation-session')
    await mainBar().getByRole('button', { name: /^选择模型，当前/ }).click()
    await page.getByRole('menuitem', { name: /^推理等级/ }).click()
    await page.getByRole('menuitemradio', { name: 'Off', exact: true }).click()
    const input = mainBar().locator('[data-composer-input]')
    await input.fill('插件验收专用：请记住项目代号 CONTEXT_BOUNDARY_NOV03，校验词 BOUNDARY_PARENT_73。此条消息只回复 PARENT_OK。以后根据问题正常回答，不调用工具。')
    await input.press('Enter')
    await expect(page.getByText('PARENT_OK', { exact: true })).toBeVisible({ timeout: 120_000 })
    await expect(mainBar().getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0, { timeout: 20_000 })
    report.parentFile = await sessionFile(report.parentId)
    report.parentHash = await settledHash(report.parentFile)
    report.mainModel = await mainBar().getByRole('button', { name: /^选择模型，当前/ }).getAttribute('aria-label')
    report.mainPermission = await mainBar().getByRole('button', { name: /^访问模式，当前/ }).getAttribute('aria-label')
    await save()
    console.log('Fresh native test parent replied PARENT_OK.')
  }
  if (!report.a) {
    report.a = await side(); await save()
    await expect(panel().locator('[data-chat-flow-key]')).toHaveCount(0)
    await expect(panel().getByText('PARENT_OK', { exact: true })).toHaveCount(0)
    expect(await panel().innerText()).not.toContain('CONTEXT_BOUNDARY_NOV03')
    report.checks.emptyOpening = true; await capture('native-boundary-empty.png'); await save()
    await editor().fill('刚才让我记住的项目代号和校验词分别是什么？只回复这两项。'); await editor().press('Enter')
  }
  await idle(report.a)
  await expect(panel()).toContainText('CONTEXT_BOUNDARY_NOV03', { timeout: 30000 }); await expect(panel()).toContainText('BOUNDARY_PARENT_73'); await expect(panel().getByText('PARENT_OK', { exact: true })).toHaveCount(0)
  expect(await panel().locator('[data-slot="conversation.chat.node"]').count()).toBeGreaterThan(0)
  expect(await panel().locator('textarea').count()).toBe(0)
  await expect(panel().getByRole('button', { name: /^用量 .*tok/ })).toHaveCount(1)
  const clocks = await panel().locator('[data-clock]').allTextContents()
  expect(clocks.filter(text => /\d{2}:\d{2}/.test(text)).length).toBeGreaterThanOrEqual(2)
  report.checks.nativeNodesUsageAndTimestamps = { usageButtons: 1, clockRows: clocks.length }
  const nativeMainClass = await mainBar().getAttribute('class')
  const nativeSideClass = await panel().locator('[data-slot="conversation.composer.bar"]').getAttribute('class')
  expect(nativeSideClass).toBe(nativeMainClass)
  expect(await panel().getByRole('button', { name: /^选择模型，当前/ }).getAttribute('aria-label')).toBe(report.mainModel)
  report.checks.inheritedInstructions = true
  report.checks.nativeComposer = true
  await capture('native-fork-composer-and-usage.png')
  await save()
  console.log('Real native fork: blank opening, inherited context, native message actions, usage and composer.')
  const menu = async bar => {
    await bar.getByRole('button', { name: '添加文件或调用指令', exact: true }).click()
    await expect(page.locator('[data-trigger-menu]').getByRole('option').first()).toBeVisible()
    const items = await page.locator('[data-trigger-menu]').getByRole('option').allTextContents()
    await page.keyboard.press('Escape')
    return items
  }
  const mainMenu = await menu(mainBar())
  const sideMenu = await menu(panel())
  expect(sideMenu.length).toBeGreaterThanOrEqual(8)
  expect(sideMenu).toEqual(mainMenu)
  report.checks.identicalNativeMenu = true
  report.menu = sideMenu
  const turns = await panel().locator('[data-turn-process]').count()
  await editor().fill('用六段介绍空气中的瑞利散射，每段两句话，不调用工具。')
  await editor().press('Enter')
  const lengths = []
  const sampleStart = Date.now()
  for (let i = 0; i < 180; i++) {
    const snapshot = await panel().evaluate(el => ({ text: el.querySelector('[data-conversation-content]')?.textContent ?? '', completed: el.querySelectorAll('[data-turn-process]').length }))
    const last = lengths.at(-1)
    if (!last || last.length !== snapshot.text.length) lengths.push({ ms: Date.now() - sampleStart, length: snapshot.text.length })
    if (snapshot.completed > turns && (await api('sidechat.info', report.a)).status === 'idle') break
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  await idle(report.a)
  await expect(panel().locator('[data-turn-process]')).toHaveCount(turns + 1, { timeout: 15_000 })
  report.streamSamples = lengths
  await save()
  expect(lengths.length).toBeGreaterThan(4)
  report.checks.incrementalStreaming = true
  report.streamSamples = lengths
  expect(allRequests.some(path => /sidechat\.(events|prompt|taskState)/.test(path))).toBe(false)
  report.checks.nativeTransport = true
  report.b = await side('刚才让我记住的项目代号和校验词分别是什么？只回复这两项。'); await save(); await idle(report.b)
  await expect(panel()).toContainText('CONTEXT_BOUNDARY_NOV03', { timeout: 30000 }); await expect(panel()).toContainText('BOUNDARY_PARENT_73'); await expect(panel().getByText('PARENT_OK', { exact: true })).toHaveCount(0)
  expect(await panel().innerText()).not.toContain('瑞利散射'); report.checks.independentCopies = true
  const deleted = []
  for (const id of [report.b, report.a]) {
    if (id !== await panel().getAttribute('data-child-session')) await page.getByRole('tab', { name: /^侧边对话/ }).first().click()
    expect(await panel().getAttribute('data-child-session')).toBe(id)
    await panel().getByRole('button', { name: '关闭侧边对话', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '关闭此侧边对话？' })
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect(editor()).toBeEditable()
    await panel().getByRole('button', { name: '关闭侧边对话', exact: true }).click()
    await dialog.getByRole('button', { name: '删除并关闭', exact: true }).click()
    await expect(page.locator(`[data-child-session="${id}"]`)).toHaveCount(0, { timeout: 30_000 })
    await expect(sessionFile(id)).rejects.toThrow('Synthetic session file unavailable')
    deleted.push(id)
  }
  report.checks.confirmedDeletion = deleted.length === 2
  expect(await hash(report.parentFile)).toBe(report.parentHash)
  expect(await mainBar().getByRole('button', { name: /^选择模型，当前/ }).getAttribute('aria-label')).toBe(report.mainModel)
  expect(await mainBar().getByRole('button', { name: /^访问模式，当前/ }).getAttribute('aria-label')).toBe(report.mainPermission)
  report.checks.parentUnchanged = true
  expect(errors).toEqual([])
  report.result = 'passed'; report.errors = errors; delete report.error
  await save()
  console.log(JSON.stringify({ result: report.result, checks: report.checks, streamUpdates: lengths.length }))
} catch (error) {
  report.result = 'failed'; report.error = String(error).split('\n').slice(0,5).join('\n'); report.errors = errors; await save()
  console.error(report.error); process.exitCode = 1
} finally { await browser.close() }
