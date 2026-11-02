import { defineConfig } from '@playwright/test'
export default defineConfig({ testDir: './tests/e2e', testMatch: '**/*.e2e.ts', workers: 1, retries: 0, timeout: 120000, use: { headless: true, viewport: { width: 1440, height: 900 }, launchOptions: process.env.SIDE_BROWSER_PATH ? { executablePath: process.env.SIDE_BROWSER_PATH } : {} } })
