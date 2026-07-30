import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const exec = promisify(execFile)
async function main(): Promise<void> {
  const status = await exec('git', ['status', '--porcelain'], { cwd: process.cwd() }); if (status.stdout.trim()) throw new Error('release:prepare 要求干净工作区')
  await exec('npm', ['run', 'verify'], { cwd: process.cwd(), shell: process.platform === 'win32' })
  await exec('npm', ['run', 'release:check'], { cwd: process.cwd(), shell: process.platform === 'win32' })
  console.log('发布准备完成；未执行 Git 写操作。')
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
