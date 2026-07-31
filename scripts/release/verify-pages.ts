import { createHash } from 'node:crypto'

interface ContentManifestFile { path: string; bytes: number; sha256: string }
interface ContentManifest { files: ContentManifestFile[] }

const argument = (name: string): string | undefined => process.argv.slice(2).find((value, index, all) => all[index - 1] === name)

function pageUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`
}

function sha256(bytes: ArrayBuffer): string {
  return createHash('sha256').update(new Uint8Array(bytes)).digest('hex')
}

function isContentManifest(value: unknown): value is ContentManifest {
  return typeof value === 'object' && value !== null && 'files' in value && Array.isArray(value.files)
    && value.files.every((file) => typeof file === 'object' && file !== null
      && 'path' in file && typeof file.path === 'string'
      && 'bytes' in file && typeof file.bytes === 'number' && Number.isSafeInteger(file.bytes) && file.bytes >= 0
      && 'sha256' in file && typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/.test(file.sha256))
}

function isJavaScriptMime(value: string | null): boolean {
  return new Set(['application/javascript', 'text/javascript', 'application/ecmascript', 'text/ecmascript', 'application/x-javascript']).has(value?.split(';', 1)[0].trim().toLowerCase() ?? '')
}

async function fetchNoCache(base: string, path: string): Promise<Response> {
  const response = await fetch(pageUrl(base, path), { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } })
  if (!response.ok) throw new Error(`Pages file unavailable: ${path} (HTTP ${response.status})`)
  return response
}

async function main(): Promise<void> {
  const base = argument('--url') ?? 'https://mykr-ysteinsk.github.io/myriad-atlas'
  const appVersion = argument('--app-version')
  const contentVersion = argument('--content-version')
  if (!appVersion || !contentVersion) throw new Error('Both --app-version and --content-version are required.')

  for (const path of ['/', '/manifest.webmanifest', '/_generated/app-changelog.json', '/_generated/knowledge-changelog.json', '/_generated/catalog.json', '/_generated/knowledge-map.json']) {
    const text = new TextDecoder().decode(await (await fetchNoCache(base, path)).arrayBuffer())
    if ((path.includes('app-changelog') && !text.includes(appVersion)) || (path.includes('knowledge-changelog') && !text.includes(contentVersion))) throw new Error(`Pages version does not match: ${path}`)
  }

  const serviceWorker = await fetchNoCache(base, '/sw.js')
  const serviceWorkerText = new TextDecoder().decode(await serviceWorker.arrayBuffer())
  if (!isJavaScriptMime(serviceWorker.headers.get('content-type'))) throw new Error(`Service Worker has an invalid Content-Type: ${serviceWorker.headers.get('content-type') ?? 'missing'}`)
  if (/^\s*(?:<!doctype html|<html\b)/i.test(serviceWorkerText)) throw new Error('Service Worker response is HTML instead of JavaScript.')

  const manifestBytes = await (await fetchNoCache(base, '/_generated/content-manifest.json')).arrayBuffer()
  let manifestValue: unknown
  try { manifestValue = JSON.parse(new TextDecoder().decode(manifestBytes)) } catch { throw new Error('Content manifest is not valid JSON.') }
  if (!isContentManifest(manifestValue)) throw new Error('Content manifest has an invalid file list.')
  if (manifestValue.files.some((file) => file.path.startsWith('.') || file.path.includes('/.'))) throw new Error('Content manifest contains a hidden path.')

  for (const file of manifestValue.files) {
    const bytes = await (await fetchNoCache(base, `/${file.path}`)).arrayBuffer()
    const actualHash = sha256(bytes)
    if (bytes.byteLength !== file.bytes || actualHash !== file.sha256) throw new Error(`Pages content verification failed: ${file.path}; expected ${file.bytes} bytes / ${file.sha256}, got ${bytes.byteLength} bytes / ${actualHash}`)
  }
  console.log('Pages release verification passed.')
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
