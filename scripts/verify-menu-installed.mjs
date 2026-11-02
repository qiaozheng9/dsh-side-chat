/** Opt-in test restricted to the dedicated installation-check chat. */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { chromium, expect } from '@playwright/test'
import { unzipSync, strFromU8 } from 'fflate'

const out = resolve('test-results/installed')
const stateFile = join(out, 'menu-session.json')
const parentId = 'session-0f44f742-121b-4cc7-8fd9-e5167a5dade9'
const parentFile = 'C:/Users/QiaoZheng/.dsh/sessions/--F-tool-dsh-dhs-side-dsh-side-chat-test-results-installed-side-chat-install-check--/' + parentId + '/session.v4.jsonl.zstd'
const port = (await readFile('C:/Users/QiaoZheng/AppData/Roaming/@deepseek-ai/dsh-desktop/DevToolsActivePort', 'utf8')).split(/\r?\n/)[0]
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('dsh-app://app/'))
if (!page) throw new Error('Desktop page unavailable')
const errors = []
page.on('pageerror', error => errors.push(error.message))
const version = JSON.parse(await readFile('package.json', 'utf8')).version
const state = process.argv.includes('--new') ? { version, parentId, checks: {} } : JSON.parse(await readFile(stateFile, 'utf8'))
const timeout = 120_000
const panel = () => page.locator('[data-dsh-side-chat]:visible').last()
const main = page.locator('[data-slot="conversation.composer.bar"]')
const mainEditor = main.locator('[contenteditable="true"]').first()
const plus = () => panel().getByRole('button', { name: '添加文件或文件夹', exact: true })
async function api(method, childId) {
  return page.evaluate(async ({ method, childId }) => {
    const response = await fetch(`/side-chat/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ childId }) })
    const data = await response.json()
    if (!data.ok) throw new Error(data.error?.message)
    return data.value
  }, { method, childId })
}
const info = id => api('sidechat.info', id)
const feed = id => api('sidechat.events', id)
const digest = async () => createHash('sha256').update(await readFile(parentFile)).digest('hex')
async function idle(id) { await expect.poll(async () => (await info(id)).status, { timeout }).toBe('idle') }
async function menu(name) {
  await expect(plus()).toBeEnabled({ timeout })
  await plus().click()
  const ids = { '添加文件': 'file', '添加文件夹': 'folder', '模型': 'model', '权限': 'permission', '压缩': 'compact', '下载日志': 'export' }
  await page.getByRole('menuitem').filter({ has: page.locator(`[data-dsh-side-action="${ids[name]}"]`) }).click()
}
async function send(id, text, reply) {
  await idle(id)
  const input = panel().getByRole('textbox', { name: '继续追问' })
  await input.fill(text)
  await expect(panel().getByRole('button', { name: '发送消息', exact: true })).toBeEnabled({ timeout })
  await input.press('Enter')
  if (reply) await expect(panel().locator('[class$="_assistant"]').getByText(reply, { exact: true })).toBeVisible({ timeout })
  await idle(id)
}
async function createSide() {
  const pending = page.waitForResponse(r => r.url().endsWith('/side-chat/api/sidechat.start'))
  await mainEditor.click()
  await mainEditor.pressSequentially('/side')
  await mainEditor.press('Enter')
  const response = await pending
  expect(response.request().postDataJSON().sessionId).toBe(parentId)
  const result = await response.json()
  expect(result.ok, JSON.stringify(result)).toBe(true)
  await expect(panel().getByRole('textbox')).toBeVisible()
  return result.value.childId
}
async function chooseModel(name) {
  await menu('模型')
  await page.getByRole('menuitem', { name: /^模型/ }).click()
  await page.getByRole('menuitemradio', { name: new RegExp(name) }).click()
}
async function exportLogs(suffix) {
  const download = page.waitForEvent('download', { timeout: 30_000 })
  await menu('下载日志')
  const result = await download
  expect(result.suggestedFilename()).toBe(`dsh-side-chat-${state.a}.zip`)
  const path = join(out, `menu-${suffix}.zip`)
  await result.saveAs(path)
  const entries = unzipSync(await readFile(path))
  const text = Object.values(entries).map(strFromU8).join('\n')
  expect(text).toContain('SIDE_A_LOG_ONLY')
  for (const excluded of ['PARENT_OK', 'PARENT_MENU_OK', 'SIDE_CHECK_NOV01', 'SIDE_B_LOG_ONLY']) expect(text).not.toContain(excluded)
  expect(Object.keys(entries)).toEqual(expect.arrayContaining(['session.jsonl', 'conversation.md', 'README.txt']))
  expect(Object.keys(entries).some(name => name.startsWith('files/') && strFromU8(entries[name]).includes('SIDE_MENU_FILE_1017'))).toBe(true)
  state.checks[`export-${suffix}`] = { file: path, entries: Object.keys(entries), excludedParentAndOtherSide: true }
}
async function parentUnchanged() {
  expect(await digest()).toBe(state.parentHash)
  expect(await main.getByRole('button', { name: /^选择模型，当前/ }).getAttribute('aria-label')).toBe(state.parentModel)
  expect(await main.getByRole('button', { name: /^访问模式，当前/ }).getAttribute('aria-label')).toBe(state.parentPermission)
  expect(await info(state.b)).toMatchObject({ model: 'deepseek-flash', permissionPreset: 'workspace-write' })
}
try {
  await expect(page).toHaveTitle(/侧边对话插件安装验证/)
  await expect(page.getByText('PARENT_OK', { exact: true })).toBeVisible()
  if (process.argv.includes('--new')) {
    if (!process.argv.includes('--cold')) {
      await mainEditor.click()
      await mainEditor.pressSequentially('继续侧边插件安装验证，不调用工具，只回复 PARENT_MENU_OK。')
      await mainEditor.press('Enter')
      await expect(page.getByText('PARENT_MENU_OK', { exact: true })).toBeVisible({ timeout })
    }
    while (await page.locator('[data-dsh-side-chat]').count()) {
      await panel().getByRole('button', { name: '关闭侧边对话', exact: true }).click()
      await page.getByRole('dialog').getByRole('button', { name: '删除并关闭', exact: true }).click()
    }
    state.a = await createSide()
    if (process.argv.includes('--cold')) state.checks.restoredMainOpensSideWithoutPrompt = true
    await chooseModel('DeepSeek-V4.1-Flash')
    await panel().getByRole('button', { name: /^选择模型，当前/ }).click()
    await page.getByRole('menuitem', { name: /^推理等级/ }).click()
    await page.getByRole('menuitemradio', { name: 'Off', exact: true }).click()
    await send(state.a, '这是独立侧边 A 的验证，不调用工具，只回复 SIDE_A_LOG_ONLY。', 'SIDE_A_LOG_ONLY')
    state.b = await createSide()
    await send(state.b, '这是独立侧边 B 的验证，不调用工具，只回复 SIDE_B_LOG_ONLY。', 'SIDE_B_LOG_ONLY')
  }
  if (process.argv.includes('--new') || process.argv.includes('--controls')) {
    await page.keyboard.press('Escape')
    await page.getByRole('tab', { name: /^侧边对话/ }).first().click()
    state.parentHash = await digest()
    state.parentModel = await main.getByRole('button', { name: /^选择模型，当前/ }).getAttribute('aria-label')
    state.parentPermission = await main.getByRole('button', { name: /^访问模式，当前/ }).getAttribute('aria-label')
    await plus().click()
    const actionMenu = page.getByRole('menu').filter({ has: page.locator('[data-dsh-side-action="folder"]') })
    expect(await actionMenu.locator('[data-dsh-side-action]').evaluateAll(items => items.map(item => item.getAttribute('data-dsh-side-action')))).toEqual(['file', 'folder', 'goal', 'plan', 'compact', 'permission', 'model', 'export'])
    await actionMenu.screenshot({ path: join(out, 'menu-six-actions.png') })
    await page.keyboard.press('Escape')
    state.checks.eightMenuItems = true
    await chooseModel('DeepSeek-V4-Pro')
    await expect.poll(async () => (await info(state.a)).model).toBe('deepseek-v4-pro')
    await parentUnchanged()
    await chooseModel('DeepSeek-V4.1-Flash')
    await menu('权限')
    await page.getByRole('menuitem', { name: '仅可查看', exact: true }).click()
    await expect.poll(async () => (await info(state.a)).permissionPreset).toBe('read-only')
    await parentUnchanged()
    await menu('权限')
    await page.getByRole('menuitem', { name: '工作区内修改', exact: true }).click()
    await expect.poll(async () => (await info(state.a)).permissionPreset).toBe('workspace-write')
    state.checks.scopedNativeModelAndPermission = true
    const fixture = join(out, 'side-chat-install-check', 'menu-attachment-check.txt')
    await writeFile(fixture, 'The verification code is SIDE_MENU_FILE_1017.\n')
    const chooser = page.waitForEvent('filechooser')
    await menu('添加文件')
    await (await chooser).setFiles(fixture)
    await send(state.a, '读取我添加的文件，只回复文件中的验证暗号，不修改任何文件。', 'SIDE_MENU_FILE_1017')
    state.checks.fileRead = true
    await mkdir(join(out, 'side-chat-install-check', 'menu-folder-check'), { recursive: true })
    await writeFile(join(out, 'side-chat-install-check', 'menu-folder-check', 'folder-code.txt'), 'SIDE_MENU_FOLDER_1017\n')
    await exportLogs('before-compact')
    state.phase = 'folder'
    console.log('Menu, model, permission, file read and ZIP isolation passed. Ready for native folder test.')
  }
  if (process.argv.includes('--finish')) {
    await expect(panel()).toContainText('menu-folder-check')
    await send(state.a, '读取所添加文件夹中的 folder-code.txt，只回复文件内的验证暗号，不修改任何文件。', 'SIDE_MENU_FOLDER_1017')
    state.checks.nativeFolderRead = true
    const bBefore = JSON.stringify(await feed(state.b))
    const compacted = page.waitForResponse(r => r.url().endsWith('/side-chat/api/sidechat.compact'), { timeout })
    await menu('压缩')
    const result = await (await compacted).json()
    expect(result.ok, JSON.stringify(result)).toBe(true)
    expect(result.value.text).toMatch(/^Compacted \d+ history items/)
    await expect(panel().getByRole('status').filter({ hasText: '压缩结果' })).toBeVisible({ timeout })
    state.checks.compact = result.value.text
    expect(JSON.stringify(await feed(state.b))).toBe(bBefore)
    await parentUnchanged()
    await exportLogs('after-compact')
    await panel().screenshot({ path: join(out, 'menu-after-compact.png') })
    for (const id of [state.a, state.b]) {
      await panel().getByRole('button', { name: '关闭侧边对话', exact: true }).click()
      await expect(page.getByRole('dialog')).toContainText('永久删除')
      const deleted = page.waitForResponse(r => r.url().endsWith('/api/delete-session/execute') && r.request().postDataJSON().sessionId === id)
      await page.getByRole('dialog').getByRole('button', { name: '删除并关闭', exact: true }).click()
      const result = await (await deleted).json()
      expect(result.value.sessionIds).toContain(id)
      expect((await api('sidechat.export', id).catch(error => error.message))).toContain('Only the current temporary side chat')
    }
    await expect(page.locator('[data-dsh-side-chat]')).toHaveCount(0)
    await access(join(out, 'side-chat-install-check', 'menu-attachment-check.txt'))
    expect(await digest()).toBe(state.parentHash)
    state.checks.closedChildrenDeletedParentAndOriginalFilesKept = true
    expect(errors).toEqual([])
    state.result = 'passed'
    delete state.error
    state.phase = 'done'
    console.log(JSON.stringify(state))
  }
} catch (error) {
  state.result = 'failed'
  state.error = String(error)
  await panel().screenshot({ path: join(out, 'menu-failed.png') }).catch(() => {})
  throw error
} finally {
  state.errors = errors
  state.checkedAt = new Date().toISOString()
  await writeFile(stateFile, JSON.stringify(state, null, 2))
  await browser.close()
}
