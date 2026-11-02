import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

describe('standalone package', () => {
  it('owns its package, mount entry and published entrypoints', () => {
    expect(pkg.name).toBe('dsh-side-chat')
    expect(pkg.exports['.'].types).toBe('./lib/types/index.d.ts')
    expect(pkg.exports['./client'].types).toBe('./lib/types/client/index.d.ts')
    expect(readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8')).toContain('name: dsh-side-chat')
  })
  it('does not depend on the original checkout or heavy sidebar features', () => {
    const dependencies = { ...pkg.dependencies, ...pkg.peerDependencies, ...pkg.devDependencies }
    for (const [name, version] of Object.entries(dependencies)) {
      expect(name).not.toMatch(/better-sidebar|codemirror|xterm|mermaid/)
      expect(version).not.toMatch(/^(?:file:|link:|workspace:)/)
    }
    const inspect = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = resolve(dir, entry.name)
        if (entry.isDirectory()) inspect(path)
        else {
          const source = readFileSync(path, 'utf8')
          expect(source).not.toMatch(/(?:from|import\s*\()\s*['"][^'"]*DSH-better-sidebar/)
          expect(source).not.toContain("from './git.ts'")
          expect(source).not.toContain("from './sidebar.module.css'")
        }
      }
    }
    inspect(resolve(root, 'src'))
    expect(Object.keys(pkg.dependencies).sort()).toEqual(['fflate', 'ws'])
  })
})
