/** Opt-in UI and enforcement verification, exclusively on the installation-check chat. */
/* global getComputedStyle */
import { readFile, writeFile, readdir, access } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { chromium, expect } from '@playwright/test'

const out = resolve('test-results/installed')
const session = JSON.parse(await readFile(join(out, 'native-session.json'), 'utf8'))
const port = (await readFile('C:/Users/QiaoZheng/AppData/Roaming/@deepseek-ai/dsh-desktop/DevToolsActivePort', 'utf8')).split(/\r?\n/)[0]
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('dsh-app://app/'))
if (page === undefined) throw new Error('Desktop application page not found')
if (process.argv.includes('--new')) {
  await expect(page).toHaveTitle(/侧边对话插件安装验证/)
  const editor = page.locator('[data-slot="conversation.composer.bar"] [contenteditable="true"]').first()
  const created = page.waitForResponse(response => response.url().endsWith('/side-chat/api/sidechat.start'))
  await editor.click()
  await editor.pressSequentially('/side')
  await editor.press('Enter')
  const response = await created
  const result = await response.json()
  if (!result.ok) throw new Error(result.error?.message)
  Object.assign(session, { childId: result.value.childId, parentId: response.request().postDataJSON().sessionId })
  await writeFile(join(out, 'native-session.json'), JSON.stringify(session))
}
const panel = page.locator('[data-dsh-side-chat]:visible').last()
const errors = []
page.on('pageerror', error => errors.push(error.message))
const report = { checkedAt: new Date().toISOString(), version: '0.1.4', checks: {}, errors, ...session }
const timeout = 120_000
async function api(method, payload) {
  return page.evaluate(async ({ method, payload }) => {
    const response = await fetch(`/side-chat/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    const result = await response.json()
    if (!result.ok) throw new Error(result.error?.message)
    return result.value
  }, { method, payload })
}
const info = () => api('sidechat.info', { childId: session.childId })
const input = () => panel.getByRole('textbox', { name: '继续追问' })
const model = () => panel.getByRole('button', { name: /^选择模型，当前/ })
const permission = () => panel.getByRole('button', { name: /^访问模式，当前/ })
async function send(text) {
  await input().fill(text)
  await expect(panel.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled({ timeout })
  await input().press('Enter')
}
async function chooseModel(name) {
  await expect(model()).toBeEnabled({ timeout })
  await model().click()
  await page.getByRole('menuitem', { name: /^模型/ }).click()
  await page.getByRole('menuitemradio', { name: new RegExp(name) }).click()
}
async function artifacts(id, root = 'C:/Users/QiaoZheng/.dsh/sessions') {
  const matches = []
  for (const item of await readdir(root, { withFileTypes: true })) {
    const path = join(root, item.name)
    if (item.name.includes(id)) matches.push(path)
    else if (item.isDirectory()) matches.push(...await artifacts(id, path))
  }
  return matches
}
try {
  expect(session.parentId).toBe('session-0f44f742-121b-4cc7-8fd9-e5167a5dade9')
  await expect(page).toHaveTitle(/侧边对话插件安装验证/)
  await expect(panel.locator('[data-dsh-side-model]')).toBeVisible()
  await expect(panel.locator('[data-dsh-side-permission]')).toBeVisible()
  await expect(model()).toContainText('1017')
  report.checks.nativeModelVersion = true
  await panel.screenshot({ path: join(out, 'native-initial.png') })
  const main = page.locator('[data-slot="conversation.composer.bar"]')
  const mainModel = main.getByRole('button', { name: /^选择模型，当前/ })
  const mainPermission = main.getByRole('button', { name: /^访问模式，当前/ })
  const initialParent = [await mainModel.getAttribute('aria-label'), await mainPermission.getAttribute('aria-label')]
  const styles = await page.locator('button[aria-label^="选择模型，当前"]').evaluateAll(buttons => buttons.map(button => {
    const style = getComputedStyle(button)
    return { font: style.font, padding: style.padding, color: style.color, borderRadius: style.borderRadius }
  }))
  expect(styles[0]).toEqual(styles[1])
  report.checks.nativeModelAppearance = true

  await permission().click()
  await page.getByRole('menuitem', { name: '完全权限', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('确认启用完全权限')
  await expect(page.getByRole('dialog').getByRole('button', { name: '启用完全权限', exact: true })).toBeDisabled()
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
  expect((await info()).permissionPreset).toBe('workspace-write')
  report.checks.permissionCancel = true
  await permission().click()
  await page.getByRole('menuitem', { name: '完全权限', exact: true }).click()
  await page.getByRole('dialog').getByRole('checkbox').check()
  await page.getByRole('dialog').getByRole('button', { name: '启用完全权限', exact: true }).click()
  await expect.poll(async () => (await info()).permissionPreset).toBe('danger-full-access')
  expect(await mainPermission.getAttribute('aria-label')).toBe(initialParent[1])
  report.checks.independentFullAccess = true
  await expect(permission()).toBeEnabled()
  await permission().click()
  await page.getByRole('menuitem', { name: '工作区内修改', exact: true }).click()
  await expect.poll(async () => (await info()).permissionPreset).toBe('workspace-write')
  console.log('Native permission confirmation and child-only switching passed.')

  await chooseModel('DeepSeek-V4-Pro')
  await expect.poll(async () => (await info()).model).toBe('deepseek-v4-pro')
  expect(await mainModel.getAttribute('aria-label')).toBe(initialParent[0])
  report.checks.independentModel = true
  await send('主对话指定的验证暗号是什么？不要调用工具，只回复暗号。')
  await expect(panel.getByText('SIDE_CHECK_NOV01', { exact: true })).toBeVisible({ timeout })
  report.checks.contextAndModelReply = true
  await chooseModel('DeepSeek-V4.1-Flash')
  await expect.poll(async () => (await info()).model).toBe('deepseek-flash')
  await expect(model()).toContainText('1017')
  await model().click()
  await page.getByRole('menuitem', { name: /^推理等级/ }).click()
  await page.getByRole('menuitemradio', { name: 'Off', exact: true }).click()
  await expect.poll(async () => (await info()).reasoningEffort).toBe('off')
  report.checks.nativeReasoningSelection = true
  console.log('Native model switch and inherited-context reply passed.')

  const fixture = join(out, 'side-chat-install-check', 'native-attachment-check.txt')
  await writeFile(fixture, 'The verification code is SIDE_NATIVE_FILE_1017.\n', 'utf8')
  await panel.getByRole('button', { name: '添加文件或文件夹', exact: true }).click()
  await expect(page.getByRole('menuitem').filter({ has: page.locator('[data-dsh-side-action="folder"]') })).toBeVisible()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('menuitem').filter({ has: page.locator('[data-dsh-side-action="file"]') }).click()
  await (await chooser).setFiles(fixture)
  await expect(panel).toContainText('native-attachment-check.txt')
  await send('请读取我添加的文件，仅回复文件中的验证暗号，不修改任何文件。')
  await expect(panel.locator('[class$="_assistant"]').getByText('SIDE_NATIVE_FILE_1017', { exact: true })).toBeVisible({ timeout })
  await access(fixture)
  report.checks.fileMenuAndReading = true
  console.log('Selected file was read successfully in the side chat.')

  await panel.getByRole('button', { name: '添加文件或文件夹', exact: true }).click()
  const imageChooser = page.waitForEvent('filechooser')
  await page.getByRole('menuitem').filter({ has: page.locator('[data-dsh-side-action="file"]') }).click()
  await (await imageChooser).setFiles(join(out, 'native-initial.png'))
  await send('这是图片附件验证。收到图片后只回复 IMAGE_OK，不调用工具。')
  await expect(panel.locator('[class$="_assistant"]').getByText('IMAGE_OK', { exact: true })).toBeVisible({ timeout })
  const feed = await api('sidechat.events', { childId: session.childId })
  expect(feed.events.some(event => event.type === 'user/message' && event.data.content?.some(block => block.type === 'image'))).toBe(true)
  report.checks.imageAdmissionAndReply = true
  console.log('Image was admitted by host storage and the model replied.')

  if (process.argv.includes('--approval')) {
    const deniedPath = 'D:/codex/visualizations/2026/10/30/01a18c2e-42a8-7381-8079-1bbfe8e7c04d/dsh-side-approval-denied-check.txt'
    await expect(access(deniedPath)).rejects.toThrow()
    await send(`调用文件写入工具，在 ${deniedPath} 写入 SIDE_APPROVAL_CHECK。这是审批流程验证，如需审批就等待用户决定，不要改写到其他路径，不要尝试绕过权限。`)
    await expect(panel.locator('[data-dsh-side-approval]')).toBeVisible({ timeout })
    await expect(panel.getByRole('button', { name: '允许一次', exact: true })).toBeVisible()
    await panel.screenshot({ path: join(out, 'native-approval.png') })
    await panel.getByRole('button', { name: '拒绝', exact: true }).click()
    await expect(panel.locator('[data-dsh-side-approval]')).toHaveCount(0)
    await expect(access(deniedPath)).rejects.toThrow()
    report.checks.manualApprovalRejected = true
    await api('sidechat.cancel', { childId: session.childId })
    console.log('Privileged side action required approval; rejecting it prevented the write.')
  }
  expect(await mainModel.getAttribute('aria-label')).toBe(initialParent[0])
  expect(await mainPermission.getAttribute('aria-label')).toBe(initialParent[1])
  report.checks.parentControlsUnchanged = true
  await panel.screenshot({ path: join(out, 'native-controls.png') })
  const mainBox = await main.locator('[contenteditable="true"]').evaluate(element => element.closest('[class*="_card"]')?.getBoundingClientRect().toJSON())
  const sideBox = await panel.locator('form').boundingBox()
  if (mainBox !== undefined && sideBox !== null) {
    const x = Math.min(mainBox.x, sideBox.x), y = Math.min(mainBox.y, sideBox.y)
    await page.screenshot({ path: join(out, 'native-composer-comparison.png'), clip: { x, y, width: Math.max(mainBox.x + mainBox.width, sideBox.x + sideBox.width) - x, height: Math.max(mainBox.y + mainBox.height, sideBox.y + sideBox.height) - y } })
  }
  await page.getByRole('tab', { name: /^侧边对话/ }).last().getByRole('button', { name: '关闭', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('永久删除')
  await page.getByRole('dialog').getByRole('button', { name: '删除并关闭', exact: true }).click()
  await expect(page.locator('[data-dsh-side-chat]')).toHaveCount(0, { timeout: 30_000 })
  expect(await artifacts(session.childId)).toEqual([])
  expect((await artifacts(session.parentId)).length).toBeGreaterThan(0)
  await access(fixture)
  report.checks.temporaryDeletionAndOriginalFileKept = true
  expect(errors).toEqual([])
  report.result = 'passed'
  console.log(JSON.stringify(report))
} catch (error) {
  report.result = 'failed'
  report.failure = error instanceof Error ? error.message : String(error)
  await panel.screenshot({ path: join(out, 'native-failed.png') }).catch(() => {})
  throw error
} finally {
  await writeFile(join(out, 'native-report.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
