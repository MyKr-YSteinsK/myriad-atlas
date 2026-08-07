import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { npmCommand } from './command'
const exec = promisify(execFile)
async function runNpm(args: string[]): Promise<void> {
  if (process.platform === 'win32') {
    await exec(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', npmCommand(), ...args], { cwd: process.cwd() })
    return
  }
  await exec(npmCommand(), args, { cwd: process.cwd() })
}
async function main(): Promise<void> {
  const status = await exec('git', ['status', '--porcelain'], { cwd: process.cwd() }); if (status.stdout.trim()) throw new Error('release:prepare 要求干净工作区')
  await runNpm(['run', 'verify'])
  await runNpm(['run', 'content:reproducibility'])
  await runNpm(['run', 'release:check'])
  console.log('发布准备完成；未执行 Git 写操作。')
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
