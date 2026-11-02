import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { setupFiles: ['tests/setup.ts'], testTimeout: 30000, exclude: ['tests/e2e/**', '**/node_modules/**', '**/dist/**'], server: { deps: { inline: [/@deepseek-ai\/dsh-client-ui-primitives/] } } } })
