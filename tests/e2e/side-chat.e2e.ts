/** Actual DSH profile smoke: public slots, native tabs, command pipeline and child creation. */
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createHostApi, dismissOnboarding, gotoPage, hostRpc, composerEditable, sidebarApi } from './host'

test('standalone side chat mounts in the real DSH host', async ({ page }) => {
  const api = await createHostApi()
  const workspacePath = process.env.DSH_E2E_WORKSPACE ?? resolve('test-results/side-smoke-workspace')
  mkdirSync(workspacePath, { recursive: true })
  try {
    const workspace = await hostRpc<{ workspace: { workspaceId: string } }>(api, 'workspace.create', { path: workspacePath })
    await hostRpc(api, 'session.create', { workspaceId: workspace.value.workspace.workspaceId })
    const pageErrors: string[] = []
    page.on('pageerror', error => { pageErrors.push(error.message); console.error('Browser error:', error.message) })
    await gotoPage(page)
    await dismissOnboarding(page)
    await expect(page.locator('[data-dsh-side-selection]')).toBeAttached({ timeout: 60_000 })
    await expect(page.locator('[data-dsh-panel-host]')).toHaveCount(0)
    const shortcut = page.getByRole('button', { name: /^(Side chat|侧边对话)$/ }).first()
    await expect(shortcut).toBeVisible({ timeout: 30_000 })
    const created = page.waitForResponse(response => response.url().includes('/side-chat/api/sidechat.start'))
    await shortcut.click()
    const result = await (await created).json() as { ok: boolean; value: { childId: string } }
    expect(result.ok).toBe(true)
    await expect(page.locator('[data-dsh-side-chat]')).toBeVisible()
    const editor = composerEditable(page)
    await editor.click()
    await editor.pressSequentially('/side', { delay: 80 })
    const second = page.waitForResponse(response => response.url().includes('/side-chat/api/sidechat.start'))
    await editor.press('Enter')
    expect((await (await second).json()).ok).toBe(true)
    await expect(page.locator('[data-dsh-side-chat]')).toHaveCount(2)
    await expect(editor).toHaveText('')
    const composer = page.locator('[data-dsh-side-chat]:visible form')
    await expect(composer).toBeVisible()
    // Native host features remain owned by the host, with no duplicate terminal.
    await page.locator('[data-dockkit-add-tab]').first().click()
    await expect(page.locator('[data-sidebar-right-guide-entry="terminal"]')).toHaveCount(1)
    await expect(page.locator('[data-sidebar-right-guide-entry="browser"]')).toHaveCount(0)
    for (const kind of ['editor', 'git', 'subagent', 'terminal-bottom']) {
      await expect(page.locator(`[data-sidebar-right-guide-entry="${kind}"]`)).toHaveCount(0)
    }
    await page.getByRole('tab', { name: /^Side chat 2(?: |$)/ }).click()
    for (const method of ['fs.tree', 'git.status', 'settings.update']) {
      const response = await api.post(sidebarApi(method), { data: {} })
      expect(response.status()).toBe(404)
    }
    expect(pageErrors).toEqual([])
    await page.screenshot({ path: resolve('test-results/side-chat/real-dsh.png') })
  } finally { await api.dispose() }
})
