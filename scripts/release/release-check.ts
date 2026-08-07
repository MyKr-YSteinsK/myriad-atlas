import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { parse } from 'yaml'
import { knowledgeFingerprint } from '../../src/lib/knowledge-fingerprint'

const exec = promisify(execFile)

interface ReleaseManifestFile { path: string; kind: string; bytes: number; sha256: string }
interface ReleaseManifest { schema_version: 1; content_version: string; base_path: '/myriad-atlas/'; files: ReleaseManifestFile[] }

function isReleaseManifest(value: unknown): value is ReleaseManifest {
  return typeof value === 'object' && value !== null
    && 'schema_version' in value && value.schema_version === 1
    && 'content_version' in value && typeof value.content_version === 'string'
    && 'base_path' in value && value.base_path === '/myriad-atlas/'
    && 'files' in value && Array.isArray(value.files)
    && value.files.every((file) => typeof file === 'object' && file !== null
      && 'path' in file && typeof file.path === 'string'
      && 'kind' in file && typeof file.kind === 'string'
      && 'bytes' in file && typeof file.bytes === 'number' && Number.isSafeInteger(file.bytes) && file.bytes >= 0
      && 'sha256' in file && typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/.test(file.sha256))
}
async function main(): Promise<void> {
  const root = process.cwd(); const [branch, status, packageJson, knowledge, manifestText, serviceWorker] = await Promise.all([exec('git', ['branch', '--show-current'], { cwd: root }), exec('git', ['status', '--porcelain'], { cwd: root }), readFile(resolve(root, 'package.json'), 'utf8'), readFile(resolve(root, 'src/data/changelog/knowledge.yaml'), 'utf8'), readFile(resolve(root, 'public/_generated/content-manifest.json'), 'utf8'), readFile(resolve(root, 'dist/sw.js'), 'utf8')])
  if (branch.stdout.trim() !== 'main') throw new Error('release:check 仅允许 main 分支')
  if (status.stdout.trim()) throw new Error('release:check 要求干净工作区')
  const app = JSON.parse(packageJson) as { version: string }; const log = parse(knowledge) as { current_version: string }
  if (!app.version || !log.current_version) throw new Error('应用或知识版本无效')
  let manifest: unknown
  try { manifest = JSON.parse(manifestText) } catch { throw new Error('正式内容清单不是有效 JSON') }
  if (!isReleaseManifest(manifest)) throw new Error('正式内容清单无效')
  if (manifest.content_version !== log.current_version) throw new Error('正式内容清单与知识版本不一致')
  if (manifest.files.some((file) => file.path === '_generated/app-changelog.json')) throw new Error('应用版本日志错误地进入了知识内容清单')
  await knowledgeFingerprint(manifest)
  if (!serviceWorker.includes('_generated/app-changelog.json')) throw new Error('应用外壳预缓存缺少应用版本日志')
  console.log(`发布检查通过：app ${app.version}，knowledge ${log.current_version}`)
  console.log('下一步由用户手动执行：git push origin main')
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
