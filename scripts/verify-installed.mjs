/** Opt-in verification against the user's running desktop app, on a dedicated test session. */
/* global document, window, MouseEvent */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { chromium, expect } from '@playwright/test'

const out = resolve('test-results/installed')
await mkdir(out, { recursive: true })
const port = (await readFile('C:/Users/QiaoZheng/AppData/Roaming/@deepseek-ai/dsh-desktop/DevToolsActivePort', 'utf8')).split(/\r?\n/)[0]
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().startsWith('dsh-app://app/'))
if (page === undefined) throw new Error('Desktop application page not found')
const errors = []
page.on('pageerror', error => errors.push(error.message))
const report = { checkedAt: new Date().toISOString(), checks: {}, errors }
const mainEditor = page.locator('[data-slot="conversation.composer.bar"] [contenteditable="true"]').first()
const marker = 'SIDE_CHECK_NOV01'
const mainPrompt = `这是侧边对话插件安装验证，不要调用工具。请记住验证暗号 ${marker}，并仅回复 PARENT_OK。`
const timeout = 120_000
const created = () => page.waitForResponse(response => response.url().endsWith('/side-chat/api/sidechat.start'), { timeout: 30_000 })
const panel = () => page.locator('[data-dsh-side-chat]:visible').last()
const mainComposer = page.locator('[data-slot="conversation.composer.bar"]')
async function artifacts(id, root = 'C:/Users/QiaoZheng/.dsh/sessions') {
  const result = []
  for (const item of await readdir(root, { withFileTypes: true })) {
    const path = join(root, item.name)
    if (item.name.includes(id)) result.push(path)
    else if (item.isDirectory()) result.push(...await artifacts(id, path))
  }
  return result
}
async function confirmDelete(childId) {
  const before = await artifacts(childId)
  expect(before.length).toBeGreaterThan(0)
  const deleted = page.waitForResponse(response => response.url().endsWith('/api/delete-session/execute') && response.request().postDataJSON().sessionId === childId)
  await page.getByRole('dialog').getByRole('button', { name: '删除并关闭', exact: true }).click()
  const result = await (await deleted).json()
  expect(result.ok).toBe(true)
  expect(result.value.sessionIds).toContain(childId)
  expect(await artifacts(childId)).toEqual([])
  report.checks.temporaryDataDeleted = true
}
async function sideInfo(childId) {
  return page.evaluate(async id => {
    const response = await fetch('/side-chat/api/sidechat.info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ childId: id }) })
    const result = await response.json()
    if (!result.ok) throw new Error(result.error?.message)
    return result.value
  }, childId)
}
try {
  await expect(page.locator('[data-dsh-side-selection]')).toHaveCount(1)
  report.checks.pluginLoaded = true
  if (process.argv.includes('--resume')) {
    // Resume only the dedicated validation session after a plugin update.
    await expect(page.getByText('PARENT_OK', { exact: true })).toBeVisible()
    while (await page.locator('[data-dsh-side-chat]').count() > 0) {
      if (await panel().count() === 0) await page.getByRole('tab', { name: /^侧边对话/ }).last().click()
      const count = await page.locator('[data-dsh-side-chat]').count()
      await panel().getByRole('button', { name: '关闭侧边对话', exact: true }).click()
      if (await page.getByRole('dialog').count() > 0) await page.getByRole('dialog').getByRole('button', { name: '删除并关闭', exact: true }).click()
      await expect(page.locator('[data-dsh-side-chat]')).toHaveCount(count - 1)
    }
  } else {
    await mainEditor.click()
    await mainEditor.pressSequentially(mainPrompt)
    await mainEditor.press('Enter')
  }
  await page.getByText('PARENT_OK', { exact: true }).waitFor({ state: 'visible', timeout })
  report.checks.mainModelReply = true
  const parentModelButton = mainComposer.getByRole('button', { name: /^选择模型，当前/ })
  const parentModelLabel = await parentModelButton.getAttribute('aria-label')
  console.log('Main model replied.')

  const first = created()
  await mainEditor.click()
  await mainEditor.pressSequentially('/side 主对话指定的验证暗号是什么？不要调用工具，只回复暗号。')
  await mainEditor.press('Enter')
  const firstResponse = await first
  const firstResult = await firstResponse.json()
  if (!firstResult.ok) throw new Error(firstResult.error?.message ?? 'Side thread creation failed')
  report.parentId = firstResponse.request().postDataJSON().sessionId
  report.childId = firstResult.value.childId
  report.checks.sideCommand = true
  await expect(panel().getByText(marker, { exact: true })).toBeVisible({ timeout })
  report.checks.inheritedContext = true
  console.log('Side model returned the parent context marker.')

  const modelCatalog = await page.evaluate(async () => (await (await fetch('/side-chat/api/sidechat.models', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()).value)
  const current = await sideInfo(report.childId)
  const allModels = modelCatalog.groups.flatMap(group => group.models.map(model => ({ provider: group.id, ...model })))
  const targetModel = allModels.find(model => model.provider !== current.provider || model.id !== current.model) ?? allModels[0]
  if (targetModel === undefined) throw new Error('No configured model is available')
  await expect(panel().getByRole('combobox', { name: '侧边对话模型' })).toBeEnabled()
  await panel().getByRole('combobox', { name: '侧边对话模型' }).selectOption(JSON.stringify([targetModel.provider, targetModel.id]))
  await expect.poll(async () => (await sideInfo(report.childId)).model).toBe(targetModel.id)
  const effort = targetModel.reasoning?.efforts.find(item => item.id !== current.reasoningEffort) ?? targetModel.reasoning?.efforts[0]
  if (effort !== undefined) {
    await panel().getByRole('combobox', { name: '推理等级' }).selectOption(effort.id)
    await expect.poll(async () => (await sideInfo(report.childId)).reasoningEffort).toBe(effort.id)
    report.checks.reasoningSelection = true
  }
  report.checks.modelSelection = true
  expect(await parentModelButton.getAttribute('aria-label')).toBe(parentModelLabel)
  report.checks.parentModelUnchanged = true

  const input = panel().getByRole('textbox', { name: '继续追问' })
  await input.fill('不要调用工具，只回复 FOLLOWUP_OK。')
  await expect(panel().getByRole('button', { name: '发送消息', exact: true })).toBeEnabled()
  await input.press('Enter')
  await expect(panel().getByText('FOLLOWUP_OK', { exact: true })).toBeVisible({ timeout })
  report.checks.followUp = true
  report.model = await sideInfo(report.childId)
  console.log('Side follow-up replied.')
  const nativeTab = page.getByRole('tab', { name: /^侧边对话/ }).last()
  await nativeTab.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog')).toContainText('永久删除')
  await panel().screenshot({ path: resolve(out, 'desktop-close-confirmation.png') })
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
  await expect(panel().getByText('FOLLOWUP_OK', { exact: true })).toBeVisible()
  report.checks.nativeCloseConfirmation = true

  const blank = created()
  await mainEditor.click()
  await mainEditor.pressSequentially('/side')
  await mainEditor.press('Enter')
  const blankResult = await (await blank).json()
  if (!blankResult.ok) throw new Error(blankResult.error?.message ?? 'Blank side thread failed')
  await expect(page.locator('[data-dsh-side-chat]')).toHaveCount(2)
  await panel().getByRole('button', { name: '关闭侧边对话', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
  expect((await artifacts(blankResult.value.childId)).length).toBeGreaterThan(0)
  await panel().getByRole('button', { name: '关闭侧边对话', exact: true }).click()
  await confirmDelete(blankResult.value.childId)
  await expect(page.locator('[data-dsh-side-chat]')).toHaveCount(1)
  report.checks.newAndClose = true

  const parentReply = page.getByText('PARENT_OK', { exact: true })
  await parentReply.evaluate(node => {
    const range = document.createRange()
    range.selectNodeContents(node)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })
  const quoted = created()
  await page.getByRole('button', { name: '在侧边对话中询问', exact: true }).click({ timeout: 10_000 })
  const quotedResult = await (await quoted).json()
  if (!quotedResult.ok) throw new Error(quotedResult.error?.message ?? 'Selection thread failed')
  await expect(panel()).toContainText('PARENT_OK')
  const quoteInput = panel().getByRole('textbox', { name: '继续追问' })
  await quoteInput.fill('不要调用工具，只回复上方引用的原文。')
  await expect(panel().getByRole('button', { name: '发送消息', exact: true })).toBeEnabled()
  const sent = page.waitForRequest(request => request.url().endsWith('/side-chat/api/sidechat.prompt'))
  await quoteInput.press('Enter')
  expect((await sent).postDataJSON().text).toContain('> PARENT_OK')
  await panel().getByRole('button', { name: '关闭侧边对话', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
  report.checks.pendingCloseConfirmation = true
  await expect(panel().locator('[class$="_assistant"]').getByText('PARENT_OK', { exact: true })).toBeVisible({ timeout })
  report.checks.selectedText = true
  await panel().getByRole('button', { name: '关闭侧边对话', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await confirmDelete(quotedResult.value.childId)
  await expect(page.locator('[data-dsh-side-chat]')).toHaveCount(1)
  report.checks.closeConfirmation = true
  await expect(panel().getByText('FOLLOWUP_OK', { exact: true })).toBeVisible()
  await panel().screenshot({ path: resolve(out, 'desktop-side-chat.png') })
  await panel().getByRole('button', { name: '关闭侧边对话', exact: true }).click()
  await confirmDelete(report.childId)
  await expect(page.locator('[data-dsh-side-chat]')).toHaveCount(0)
  expect((await artifacts(report.parentId)).length).toBeGreaterThan(0)
  report.checks.parentDataKept = true
  expect(errors).toEqual([])
  report.result = 'passed'
  console.log(JSON.stringify({ result: report.result, checks: report.checks, model: report.model.model, screenshot: resolve(out, 'desktop-side-chat.png') }))
} catch (error) {
  report.result = 'failed'
  report.failure = error instanceof Error ? error.message : String(error)
  await page.screenshot({ path: resolve(out, 'failed.png') }).catch(() => {})
  throw error
} finally {
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
