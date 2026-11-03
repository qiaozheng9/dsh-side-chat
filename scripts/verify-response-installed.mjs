/** Opt-in: run only in a freshly created, empty DSH test chat. */
import { readFile, writeFile, readdir, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { chromium, expect } from '@playwright/test'

const out = resolve('test-results/installed')
const state = join(out, 'response-session-0.1.12.json')
const port = (await readFile('C:/Users/QiaoZheng/AppData/Roaming/@deepseek-ai/dsh-desktop/DevToolsActivePort', 'utf8')).split(/\r?\n/)[0]
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('dsh-app://app/'))
const panel = () => page.locator('[data-dsh-side-chat]:visible').last()
const main = page.locator('[data-slot="conversation.composer.bar"]')
const report = process.argv.includes('--new') ? { version: '0.1.12', checks: {}, replies: [] } : JSON.parse(await readFile(state, 'utf8'))
const save = () => writeFile(state, JSON.stringify(report, null, 2))
async function capture(name) {
  // Electron's background windows can pause animation frames; a direct
  // capture avoids screenshot auto-scrolling/font waits unrelated to the UI.
  const clip = await panel().boundingBox()
  const cdp = await page.context().newCDPSession(page)
  try {
    const image = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, clip: { ...clip, scale: 1 } })
    await writeFile(join(out, name), Buffer.from(image.data, 'base64'))
  } finally { await cdp.detach() }
}
const errors = []
page.on('pageerror', error => errors.push(error.message))
async function api(method, payload) {
  return page.evaluate(async ({ method, payload }) => {
    const result = await (await fetch(`/side-chat/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })).json()
    if (!result.ok) throw new Error(result.error?.message)
    return result.value
  }, { method, payload })
}
const info = () => api('sidechat.info', { childId: report.childId })
async function idle() {
  await expect.poll(async () => (await info()).status, { timeout: 180_000 }).toBe('idle')
  await expect(panel().getByRole('log')).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 })
  await expect(panel().getByRole('button', { name: '停止回复', exact: true })).toHaveCount(0)
  await expect(panel().locator('[data-side-reasoning-state="running"]')).toHaveCount(0)
}
async function effort(value) {
  const button = panel().getByRole('button', { name: /^选择模型，当前/ })
  await expect(button).toBeEnabled()
  await button.click()
  await page.getByRole('menuitem', { name: /^推理等级/ }).click()
  await page.getByRole('menuitemradio', { name: value, exact: true }).click()
}
async function ask(question) {
  await idle()
  const count = await panel().locator('[data-side-turn-state]').count()
  const input = panel().getByRole('textbox', { name: '继续追问' })
  await input.fill(question); await input.press('Enter')
  await expect(panel().locator('[data-side-turn-state="completed"]')).toHaveCount(count + 1, { timeout: 180_000 })
  await idle()
  const feed = await api('sidechat.events', { childId: report.childId })
  const own = feed.events.filter(e => e.type === 'assistant/message')
  const answer = own.at(-1).data.message.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
  expect(answer).not.toMatch(/侧边|侧栏|旁支|side\s*(chat|conversation|panel)|上下文边界/i)
  report.replies.push({ question, answer })
  await save()
  return answer
}
async function parentPath(id) {
  const root = 'C:/Users/QiaoZheng/.dsh/sessions'
  for (const item of await readdir(root, { withFileTypes: true })) {
    if (!item.isDirectory()) continue
    const path = join(root, item.name, id, 'session.v4.jsonl.zstd')
    try { await access(path); return path } catch { /* inspect only this synthetic ID */ }
  }
  throw new Error('Synthetic parent log not found')
}
const hash = async path => createHash('sha256').update(await readFile(path)).digest('hex')
try {
  if (process.argv.includes('--new')) {
    expect(await page.locator('[data-turn-process]').count()).toBe(0)
    const editor = main.locator('[contenteditable="true"]').first()
    expect(await editor.innerText()).toBe('')
    // This selection belongs to the new, empty test chat.
    await main.getByRole('button', { name: /^选择模型，当前/ }).click()
    await page.getByRole('menuitem', { name: /^推理等级/ }).click()
    await page.getByRole('menuitemradio', { name: 'Off', exact: true }).click()
    await editor.fill('这是侧边对话插件安装验证（回复状态修复），请记住暗号 STATUS_NOV03，只回复 PARENT_OK，不调用工具。')
    await editor.press('Enter')
    await expect(page.getByText('PARENT_OK', { exact: true })).toBeVisible({ timeout: 120_000 })
    await expect(main.getByRole('button', { name: '停止回复', exact: true })).toHaveCount(0, { timeout: 30_000 })
    const response = page.waitForResponse(r => r.url().endsWith('/side-chat/api/sidechat.start'))
    await main.getByRole('button', { name: '侧边对话', exact: true }).click()
    const result = await response
    report.parentId = result.request().postDataJSON().sessionId
    const body = await result.json(); expect(body.ok).toBe(true)
    report.childId = body.value.childId
    report.parentFile = await parentPath(report.parentId)
    report.parentHash = await hash(report.parentFile)
    report.parentControls = await main.locator('button[aria-label^="选择模型"],button[aria-label^="访问模式"]').evaluateAll(ns => ns.map(n => n.getAttribute('aria-label')))
    await save()
    console.log('Fresh synthetic parent and side chat created.')
  }
  expect(await panel().count()).toBe(1)
  if (!report.checks.naturalRepliesAndContext) {
    await effort('Off')
    await ask('为什么天空通常是蓝色的？用两句话解释。')
    await ask('那日落时为什么偏红？')
    const marker = await ask('刚才请你记住的暗号是什么？只回复暗号。')
    expect(marker).toContain('STATUS_NOV03')
    report.checks.naturalRepliesAndContext = true
    await save()
    console.log('Three ordinary follow-ups: no unsolicited side-chat announcements; inherited context intact.')
  }
  if (!report.replies.some(reply => reply.question.startsWith('请直接心算'))) {
    await effort('Max')
    await ask('请直接心算：从1到30中，能被3整除但不能被5整除的整数之和是多少？给出简短计算过程。')
  }
  await expect(panel().locator('[data-side-reasoning-state="done"]')).toHaveCount(1)
  await expect(panel()).toContainText('已完成分析')
  const header = panel().locator('[data-side-turn-state="completed"]').last()
  await expect(header).toContainText('已完成，用时')
  await header.click()
  await expect(header).toHaveAttribute('aria-expanded', 'false')
  await expect(panel().locator('[data-side-reasoning-state]')).toHaveCount(0)
  await header.click()
  const reasoning = panel().locator('[data-side-reasoning-state="done"]').getByRole('button').first()
  if (await reasoning.getAttribute('aria-expanded') !== 'true') await reasoning.click()
  await capture('response-completed-0.1.12.png')
  report.checks.completedReasoningAndFold = true
  await save()
  console.log('Real Max reasoning finished: native analysis-complete label, duration, disclosure and no active-thinking residue.')
  const input = panel().getByRole('textbox', { name: '继续追问' })
  await input.fill('请从1开始逐行列出每个整数的平方，一直写到10000，每行一个。直接计算输出，不调用工具。')
  await input.press('Enter')
  const stop = panel().getByRole('button', { name: '停止回复', exact: true })
  await expect(stop).toBeVisible({ timeout: 30_000 })
  await expect.poll(async () => (await api('sidechat.events', { childId: report.childId })).live.length, { timeout: 60_000 }).toBeGreaterThan(0)
  await capture('response-running-0.1.12.png')
  await stop.click()
  await expect(panel().locator('[data-side-turn-state="stopped"]')).toBeVisible({ timeout: 30_000 })
  await idle()
  report.checks.stop = true
  expect(await hash(report.parentFile)).toBe(report.parentHash)
  expect(await main.locator('button[aria-label^="选择模型"],button[aria-label^="访问模式"]').evaluateAll(ns => ns.map(n => n.getAttribute('aria-label')))).toEqual(report.parentControls)
  report.checks.parentUnchanged = true
  await panel().getByRole('button', { name: '关闭侧边对话', exact: true }).click()
  await page.getByRole('dialog', { name: '关闭此侧边对话？' }).getByRole('button', { name: '删除并关闭', exact: true }).click()
  await expect(page.locator('[data-dsh-side-chat]')).toHaveCount(0)
  await expect(access(join(resolve(report.parentFile, '..', '..'), report.childId))).rejects.toMatchObject({ code: 'ENOENT' })
  report.checks.deleted = true
  expect(errors).toEqual([])
  report.errors = errors; report.result = 'passed'; delete report.error
  await save()
  console.log(JSON.stringify({ result: report.result, checks: report.checks }))
} catch (error) {
  report.result = 'failed'; report.error = String(error).split('\n').slice(0,4).join('\n'); await save()
  // Never dump the whole desktop accessibility tree on assertion failure.
  console.error(report.error)
  process.exitCode = 1
} finally { await browser.close() }
