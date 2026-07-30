import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { parse } from 'yaml'

const exec = promisify(execFile)
async function main(): Promise<void> {
  const root = process.cwd(); const [branch, status, packageJson, knowledge] = await Promise.all([exec('git', ['branch', '--show-current'], { cwd: root }), exec('git', ['status', '--porcelain'], { cwd: root }), readFile(resolve(root, 'package.json'), 'utf8'), readFile(resolve(root, 'src/data/changelog/knowledge.yaml'), 'utf8')])
  if (branch.stdout.trim() !== 'main') throw new Error('release:check 仅允许 main 分支')
  if (status.stdout.trim()) throw new Error('release:check 要求干净工作区')
  const app = JSON.parse(packageJson) as { version: string }; const log = parse(knowledge) as { current_version: string }
  if (!app.version || !log.current_version) throw new Error('应用或知识版本无效')
  console.log(`发布检查通过：app ${app.version}，knowledge ${log.current_version}`)
  console.log('下一步由用户手动执行：git push origin main')
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
