/** Additional installed-native checks, limited to verify-native-fork-installed's test parent. */
import { readFile, writeFile, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { chromium, expect } from '@playwright/test'
const out = resolve('test-results/installed')
const fixture = join(out, 'side-chat-install-check', 'native-fork-attachment.txt')
const report = JSON.parse(await readFile(join(out, 'native-fork-controls-0.2.0.json'), 'utf8').catch(() => readFile(join(out, 'native-fork-0.2.0.json'), 'utf8')))
const port = (await readFile('C:/Users/QiaoZheng/AppData/Roaming/@deepseek-ai/dsh-desktop/DevToolsActivePort', 'utf8')).split(/\r?\n/)[0]
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('dsh-app://app/'))
const panel = () => page.locator('[data-dsh-native-side-chat]:visible').last()
const main = page.locator('[data-slot="main.conversation"]')
const editor = () => panel().locator('[data-composer-input]')
const save = () => writeFile(join(out, 'native-fork-controls-0.2.0.json'), JSON.stringify(report, null, 2))
async function idle() {
  await expect.poll(async () => page.evaluate(async id => (await (await fetch('/side-chat/api/sidechat.info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ childId: id }) })).json()).value.status, report.controlsId), { timeout: 120_000 }).toBe('idle')
  await expect(panel().getByRole('button', { name: '停止回复', exact: true })).toHaveCount(0)
}
async function send(text) {
  await editor().fill(text)
  const button = panel().getByRole('button', { name: '发送消息', exact: true })
  await expect(button).toBeEnabled({ timeout: 30_000 })
  await button.click()
}
async function action(name) {
  await panel().getByRole('button', { name: '添加文件或调用指令', exact: true }).click()
  await page.locator('[data-trigger-menu]').getByRole('option', { name: new RegExp(`^${name}`) }).click()
  if (name === '计划' || name === '下载日志') await editor().press('Enter')
}
try {
  if (process.argv.includes('--verify-closed')) {
    await access(fixture)
    expect(await readFile(fixture, 'utf8')).toBe('The unique attachment code is NATIVE_FORK_FILE_OK.\n')
    await expect(access(resolve(report.parentFile, '..', '..', report.controlsId))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(createHash('sha256').update(await readFile(report.parentFile)).digest('hex')).toBe(report.parentHash)
    expect(report.checks.nativePlanReview).toBe(true)
    expect(report.checks.nativeExport).toBe(true)
    report.checks.parentAndOriginalFileUnchanged = true
    report.controlsResult = 'passed'; delete report.controlsError; await save()
    console.log(JSON.stringify({ result: 'passed', checks: report.checks }))
    await browser.close()
    process.exit(0)
  }
  expect(await main.locator('[data-conversation-content]').getAttribute('data-conversation-session')).toBe(report.parentId)
  if (!report.controlsId) {
    const opening = page.waitForResponse(r => r.url().endsWith('/side-chat/api/sidechat.start'))
    const parentEditor = main.locator('[data-composer-input]')
    await parentEditor.fill('/side'); await parentEditor.press('Enter')
    const result = await (await opening).json(); expect(result.ok).toBe(true)
    report.controlsId = result.value.childId; await save()
  }
  if (await panel().count() === 0) await page.getByRole('tab', { name: /^侧边对话/ }).first().click()
  expect(await panel().getAttribute('data-child-session')).toBe(report.controlsId)
  const reviewing = await panel().getByRole('button', { name: /^同意执行/ }).count() > 0
  if (!reviewing) {
  await expect(editor()).toBeEditable({ timeout: 30_000 })
  await idle()
  const permission = () => panel().getByRole('button', { name: /^访问模式，当前/ })
  await permission().click(); await page.getByRole('menuitem', { name: '仅可查看', exact: true }).click()
  await expect(permission()).toHaveAttribute('aria-label', /仅可查看/)
  expect(await main.getByRole('button', { name: /^访问模式，当前/ }).getAttribute('aria-label')).toBe(report.mainPermission)
  await permission().click(); await page.getByRole('menuitem', { name: '工作区内修改', exact: true }).click()
  report.checks.nativePermissionIsolation = true
  const model = () => panel().getByRole('button', { name: /^选择模型，当前/ })
  await model().click(); await page.getByRole('menuitem', { name: /^推理等级/ }).click(); await page.getByRole('menuitemradio', { name: 'Max', exact: true }).click()
  await expect(model()).toHaveAttribute('aria-label', /Max/)
  expect(await main.getByRole('button', { name: /^选择模型，当前/ }).getAttribute('aria-label')).toBe(report.mainModel)
  await model().click(); await page.getByRole('menuitem', { name: /^推理等级/ }).click(); await page.getByRole('menuitemradio', { name: 'Off', exact: true }).click()
  report.checks.nativeModelIsolation = true
  console.log('Native permission and reasoning controls remain child-bound.')
  await writeFile(fixture, 'The unique attachment code is NATIVE_FORK_FILE_OK.\n')
  if (await panel().getByText('NATIVE_FORK_FILE_OK', { exact: true }).count() === 0) {
    const fileChooser = page.waitForEvent('filechooser', { timeout: 10_000 })
    await action('文件')
    await (await fileChooser).setFiles(fixture)
    await expect(panel()).toContainText('native-fork-attachment.txt')
    await send('请只读取本次附件，回复其中的唯一验证暗号。不读取其他文件，不修改文件。')
  }
  await expect(panel().getByText('NATIVE_FORK_FILE_OK', { exact: true })).toBeVisible({ timeout: 120_000 })
  await idle()
  report.checks.nativeAttachment = true
  await save()
  console.log('Native file picker, upload receipt and model attachment reading passed.')
  if ((await editor().innerText()).includes('/计划')) await editor().press('Enter')
  else await action('计划')
  await expect(panel().getByRole('button', { name: '计划模式已开启，按下关闭', exact: true })).toBeVisible({ timeout: 15_000 })
  expect(await main.getByRole('button', { name: '计划模式已开启，按下关闭', exact: true }).count()).toBe(0)
  await send('这是计划审核验证。不要执行实际任务，不读取或修改任何文件。请调用 exit_plan_mode 提交标题为 # NATIVE_FORK_PLAN 的两步只读检查计划，等待批准；批准后只回复 NATIVE_PLAN_OK，不执行计划。')
  }
  await expect.poll(async () => page.locator('[data-dsh-native-side-chat] button').filter({ hasText: '同意执行' }).count(), { timeout: 120_000 }).toBeGreaterThan(0)
  // Native plan review opens its document preview in another right tab.
  // Return to the chat to approve through the native interaction surface.
  if (await panel().count() === 0) await page.getByRole('tab', { name: /^侧边对话/ }).first().click()
  await expect(panel().getByRole('button', { name: /^同意执行/ })).toBeVisible()
  const cdp = await page.context().newCDPSession(page)
  try {
    const clip = await panel().boundingBox()
    const image = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, clip: { ...clip, scale: 1 } })
    await writeFile(join(out, 'native-fork-plan-review.png'), Buffer.from(image.data, 'base64'))
  } finally { await cdp.detach() }
  await panel().getByRole('button', { name: /^同意执行/ }).click()
  await expect(panel().getByText('NATIVE_PLAN_OK', { exact: true })).toBeVisible({ timeout: 120_000 })
  await idle()
  report.checks.nativePlanReview = true
  const download = page.waitForEvent('download', { timeout: 30_000 })
  await action('下载日志')
  const zip = await download
  report.nativeExportName = zip.suggestedFilename()
  await zip.saveAs(join(out, 'native-fork-export.zip'))
  expect((await readFile(join(out, 'native-fork-export.zip'))).length).toBeGreaterThan(100)
  report.checks.nativeExport = true
  console.log('Native plan approval and ZIP export passed.')
  await panel().getByRole('button', { name: '关闭侧边对话', exact: true }).click()
  await page.getByRole('dialog', { name: '关闭此侧边对话？' }).getByRole('button', { name: '删除并关闭', exact: true }).click()
  await expect(panel()).toHaveCount(0, { timeout: 20_000 })
  const previewTab = page.getByRole('tab', { name: 'NATIVE_FORK_PLAN', exact: true })
  if (await previewTab.count()) await previewTab.getByRole('button', { name: '关闭', exact: true }).click()
  await access(fixture)
  expect(createHash('sha256').update(await readFile(report.parentFile)).digest('hex')).toBe(report.parentHash)
  report.checks.parentAndOriginalFileUnchanged = true
  report.controlsResult = 'passed'; delete report.controlsError; await save()
  console.log(JSON.stringify({ result: report.controlsResult, checks: report.checks }))
} catch (error) {
  report.controlsResult = 'failed'; report.controlsError = String(error).split('\n').slice(0,4).join('\n'); await save(); console.error(report.controlsError); process.exitCode = 1
} finally { await browser.close() }
