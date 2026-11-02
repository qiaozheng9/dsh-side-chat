/** Opt-in verification limited to the synthetic installation-check chat. */
/* global getComputedStyle */
import { readFile, writeFile, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { chromium, expect } from '@playwright/test'

const out = resolve('test-results/installed')
const stateFile = join(out, 'features-session.json')
const parentId = 'session-0f44f742-121b-4cc7-8fd9-e5167a5dade9'
const group = 'C:/Users/QiaoZheng/.dsh/sessions/--F-tool-dsh-dhs-side-dsh-side-chat-test-results-installed-side-chat-install-check--'
const parentFile = join(group, parentId, 'session.v4.jsonl.zstd')
const port = (await readFile('C:/Users/QiaoZheng/AppData/Roaming/@deepseek-ai/dsh-desktop/DevToolsActivePort', 'utf8')).split(/\r?\n/)[0]
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('dsh-app://app/'))
if (!page) throw new Error('DSH desktop page unavailable')
const version = JSON.parse(await readFile('package.json', 'utf8')).version
const report = process.argv.includes('--new') ? { version, parentId, checks: {} } : JSON.parse(await readFile(stateFile, 'utf8'))
const errors = []; page.on('pageerror', error => errors.push(error.message))
const main = page.locator('[data-slot="conversation.composer.bar"]')
const panel = () => page.locator('[data-dsh-side-chat]:visible').last()
const dialog = () => page.getByRole('dialog', { name: '侧边对话目标', exact: true })
const timeout = 120_000
async function api(method, childId, data = {}) {
  return page.evaluate(async ({ method, childId, data }) => {
    const response = await fetch(`/side-chat/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ childId, ...data }) })
    const result = await response.json()
    if (!result.ok) throw new Error(result.error?.message)
    return result.value
  }, { method, childId, data })
}
const state = id => api('sidechat.taskState', id)
const info = id => api('sidechat.info', id)
const hash = async () => createHash('sha256').update(await readFile(parentFile)).digest('hex')
async function create() {
  const pending = page.waitForResponse(r => r.url().endsWith('/side-chat/api/sidechat.start'))
  const editor = main.locator('[contenteditable="true"]').first()
  await editor.click(); await editor.pressSequentially('/side'); await editor.press('Enter')
  const response = await pending
  expect(response.request().postDataJSON().sessionId).toBe(parentId)
  const result = await response.json(); expect(result.ok, JSON.stringify(result)).toBe(true)
  return result.value.childId
}
const plus = () => panel().getByRole('button', { name: '添加文件或文件夹', exact: true })
async function action(id) {
  await plus().click()
  await page.getByRole('menuitem').filter({ has: page.locator(`[data-dsh-side-action="${id}"]`) }).click()
}
async function isolated() {
  expect(await hash()).toBe(report.parentHash)
  expect(await state(report.b)).toEqual(report.bState)
}
async function openGoal() {
  const summary = panel().locator('[class*="taskBar"] button')
  if (await summary.count()) await summary.click(); else await action('goal')
  await expect(dialog()).toBeVisible()
}
async function send(text) {
  await expect.poll(async () => (await info(report.a)).status, { timeout }).toBe('idle')
  const input = panel().getByRole('textbox', { name: '继续追问' })
  await input.fill(text); await input.press('Enter')
}
const style = element => { const value = getComputedStyle(element); return { fontSize: value.fontSize, lineHeight: value.lineHeight, padding: value.padding, minHeight: value.minHeight } }
async function close(id) {
  await panel().getByRole('button', { name: '关闭侧边对话', exact: true }).click()
  const modal = page.getByRole('dialog', { name: '关闭此侧边对话？' })
  await expect(modal.getByRole('button', { name: '取消', exact: true })).toBeFocused()
  await expect(modal).toContainText('永久删除')
  await modal.getByRole('button', { name: '删除并关闭', exact: true }).click()
  await expect(modal).toHaveCount(0)
  await expect(access(join(group, id))).rejects.toMatchObject({ code: 'ENOENT' })
}
try {
  await expect(page).toHaveTitle(/侧边对话插件安装验证/)
  await expect(page.getByText('PARENT_OK', { exact: true })).toBeVisible()
  if (process.argv.includes('--new')) {
    while (await page.locator('[data-dsh-side-chat]').count()) {
      const count = await page.locator('[data-dsh-side-chat]').count()
      await expect(panel().getByRole('log')).toContainText('你想了解什么？')
      await panel().getByRole('button', { name: '关闭侧边对话', exact: true }).click()
      await page.getByRole('dialog').getByRole('button', { name: '删除并关闭', exact: true }).click()
      await expect(page.locator('[data-dsh-side-chat]')).toHaveCount(count - 1)
    }
    report.a = await create(); report.b = await create()
    await page.getByRole('tab', { name: /^侧边对话/ }).first().click()
    report.parentHash = await hash(); report.bState = await state(report.b)
    await main.getByRole('button', { name: '添加文件或调用指令', exact: true }).click()
    const nativeRow = page.getByRole('option').filter({ hasText: '压缩' })
    await expect(nativeRow).toHaveCount(1)
    report.nativeStyle = await nativeRow.evaluate(style)
    await page.getByRole('listbox').screenshot({ path: join(out, 'original-main-menu.png') })
    await page.keyboard.press('Escape')
    await plus().click()
    const menu = page.getByRole('menu').filter({ has: page.locator('[data-dsh-side-action="goal"]') })
    await expect(menu.getByRole('menuitem')).toHaveCount(8)
    await expect(menu.locator('[data-dsh-side-action] svg')).toHaveCount(8)
    const row = menu.getByRole('menuitem').filter({ has: page.locator('[data-dsh-side-action="compact"]') })
    report.sideStyle = await row.evaluate(style)
    expect(report.sideStyle).toEqual(report.nativeStyle)
    expect(await menu.locator('[class*="menuDescription"]').count()).toBe(8)
    await menu.screenshot({ path: join(out, 'side-menu-eight-actions.png') })
    await page.keyboard.press('Escape')
    report.checks.originalMenuTypographyIconsDescriptions = true
    report.phase = 'goals'
  }
  if (process.argv.includes('--goals')) {
    await openGoal()
    const objective = '侧边目标隔离验证：暂时不要完成此目标，不调用工具，只回复 SIDE_GOAL_RUNNING。'
    await dialog().getByRole('textbox', { name: '目标内容' }).fill(objective)
    await dialog().evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))
    await dialog().screenshot({ path: join(out, 'side-goal-dialog.png') })
    await dialog().getByRole('button', { name: '开始目标', exact: true }).click()
    await expect(dialog()).toHaveCount(0)
    await expect.poll(async () => (await state(report.a)).goal?.objective).toBe(objective)
    await openGoal()
    await dialog().getByRole('button', { name: '暂停目标', exact: true }).click()
    await expect.poll(async () => (await state(report.a)).goal?.phase).toBe('paused')
    await api('sidechat.cancel', report.a)
    await expect.poll(async () => (await info(report.a)).status, { timeout }).toBe('idle')
    await isolated()
    await openGoal()
    const edited = '侧边目标编辑验证：不要调用文件或命令工具，只回复 SIDE_GOAL_EDITED，随后通过目标工具将本目标标记为完成。'
    await dialog().getByRole('textbox', { name: '目标内容' }).fill(edited)
    await dialog().getByRole('button', { name: '保存目标', exact: true }).click()
    await expect.poll(async () => (await state(report.a)).goal?.objective).toBe(edited)
    expect((await state(report.a)).goal.phase).toBe('paused')
    await openGoal()
    await dialog().getByRole('button', { name: '继续目标', exact: true }).click()
    await expect(dialog()).toHaveCount(0)
    await expect(panel().locator('[class$="_assistant"]').getByText('SIDE_GOAL_EDITED', { exact: true })).toBeVisible({ timeout })
    await api('sidechat.cancel', report.a)
    await expect.poll(async () => (await info(report.a)).status, { timeout }).toBe('idle')
    await openGoal()
    await dialog().getByRole('button', { name: '清除目标', exact: true }).click()
    await expect.poll(async () => (await state(report.a)).goal).toBeUndefined()
    await isolated()
    report.checks.goalCreatePauseEditResumeClearAndModelReply = true
    report.phase = 'plan'
    console.log('Goal lifecycle and side-only scope passed.')
  }
  if (process.argv.includes('--plan')) {
    await action('plan')
    await expect.poll(async () => (await state(report.a)).plan?.active).toBe(true)
    await isolated()
    await action('plan')
    await expect.poll(async () => (await state(report.a)).plan?.active).toBe(false)
    await action('plan')
    await expect.poll(async () => (await state(report.a)).plan?.active).toBe(true)
    await send('请为一个只读检查任务制定两步计划。不要读取或修改文件，也不要执行任何检查。必须调用 exit_plan_mode 提交计划，plan 参数为 markdown，标题为 # SIDE_PLAN_REVIEW。等待我审核，批准后只回复 SIDE_PLAN_DONE，不执行任何实际操作。')
    const review = panel().locator('[data-dsh-side-question]')
    await expect(review).toContainText('SIDE_PLAN_REVIEW', { timeout })
    await expect(review.getByRole('button', { name: '批准计划', exact: true })).toBeVisible()
    await review.screenshot({ path: join(out, 'side-plan-review.png') })
    await isolated()
    await review.getByRole('button', { name: '批准计划', exact: true }).click()
    await expect(review).toHaveCount(0)
    await expect(panel().locator('[class$="_assistant"]').getByText('SIDE_PLAN_DONE', { exact: true })).toBeVisible({ timeout })
    await expect.poll(async () => (await info(report.a)).status, { timeout }).toBe('idle')
    expect((await state(report.a)).plan.active).toBe(false)
    await isolated()
    report.checks.nativePlanEnterExitReviewAndExplicitApproval = true
    report.phase = 'close'
    console.log('Native plan mode, review and explicit approval passed.')
  }
  if (process.argv.includes('--close')) {
    if (process.argv.includes('--pending-review')) {
      await action('plan')
      await expect.poll(async () => (await state(report.a)).plan?.active).toBe(true)
      await send('这是计划审核取消验证，不读取或修改文件。请立即调用 exit_plan_mode 提交一段 markdown 计划，标题为 # SIDE_PLAN_CANCEL，等待我审核，不执行计划。')
      await expect(panel().locator('[data-dsh-side-question]')).toContainText('SIDE_PLAN_CANCEL', { timeout })
    }
    await panel().getByRole('button', { name: '关闭侧边对话', exact: true }).click()
    const modal = page.getByRole('dialog', { name: '关闭此侧边对话？' })
    await expect(modal.getByRole('button', { name: '取消', exact: true })).toBeFocused()
    await modal.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))
    await modal.screenshot({ path: join(out, 'side-close-dialog.png') })
    await page.screenshot({ path: join(out, 'side-close-overlay.png') })
    await page.keyboard.press('Tab')
    await expect(modal.getByRole('button', { name: '删除并关闭', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(modal.getByRole('button', { name: '取消', exact: true })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(modal).toHaveCount(0)
    await expect(access(join(group, report.a))).resolves.toBeUndefined()
    await panel().getByRole('button', { name: '关闭侧边对话', exact: true }).click()
    await modal.getByRole('button', { name: '取消', exact: true }).click()
    await expect(modal).toHaveCount(0)
    if (process.argv.includes('--pending-review')) expect((await info(report.a)).questions).toHaveLength(1)
    await isolated()
    await close(report.a); await close(report.b)
    expect(await hash()).toBe(report.parentHash)
    report.checks.nativeCloseDialogFocusTrapEscapeCancelAndPermanentDeletion = true
    if (process.argv.includes('--pending-review')) report.checks.unansweredPlanReviewCancelledOnClose = true
    report.result = 'passed'; delete report.error; report.phase = 'done'
    expect(errors).toEqual([])
    console.log(JSON.stringify(report))
  }
} catch (error) {
  report.result = 'failed'; report.error = String(error)
  await page.screenshot({ path: join(out, 'features-failed.png') }).catch(() => {})
  throw error
} finally {
  report.errors = errors; report.checkedAt = new Date().toISOString()
  await writeFile(stateFile, JSON.stringify(report, null, 2))
  await browser.close()
}
