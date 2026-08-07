import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { knowledgeFingerprint } from '../../src/lib/knowledge-fingerprint'

interface ContentManifestFile { path: string; kind: string; bytes: number; sha256: string }
interface ContentManifest { schema_version: 1; content_version: string; base_path: '/myriad-atlas/'; files: ContentManifestFile[] }
interface FetchedBytes { response: Response; bytes: ArrayBuffer }
interface FetchBytesOptions {
  fetch?: typeof fetch
  sleep?: (milliseconds: number) => Promise<void>
}

const RETRYABLE_NETWORK_CODES = new Set([
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ENETRESET',
  'EAI_AGAIN',
])
const RETRY_DELAYS = [250, 750]

const argument = (name: string): string | undefined => process.argv.slice(2).find((_value, index, all) => all[index - 1] === name)

function pageUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`
}

function sha256(bytes: ArrayBuffer): string {
  return createHash('sha256').update(new Uint8Array(bytes)).digest('hex')
}

function isContentManifest(value: unknown): value is ContentManifest {
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

export async function validatePagesManifest(value: unknown, expectedContentVersion: string): Promise<ContentManifest> {
  if (!isContentManifest(value)) throw new Error('Content manifest has an invalid file list.')
  if (value.content_version !== expectedContentVersion) throw new Error('Content manifest version does not match the requested knowledge version.')
  if (value.files.some((file) => file.path === '_generated/app-changelog.json')) throw new Error('Content manifest must not include the app changelog.')
  if (value.files.some((file) => file.path.startsWith('.') || file.path.includes('/.'))) throw new Error('Content manifest contains a hidden path.')
  await knowledgeFingerprint(value)
  return value
}

function isJavaScriptMime(value: string | null): boolean {
  return new Set(['application/javascript', 'text/javascript', 'application/ecmascript', 'text/ecmascript', 'application/x-javascript']).has(value?.split(';', 1)[0].trim().toLowerCase() ?? '')
}

function networkErrorDetails(error: unknown): { code?: string; message: string; retryable: boolean } {
  const records: Array<Record<string, unknown>> = []
  let candidate = error
  while (typeof candidate === 'object' && candidate !== null && records.length < 3) {
    const record = candidate as Record<string, unknown>
    records.push(record)
    candidate = record.cause
  }

  const code = records.map((record) => typeof record.code === 'string' ? record.code : undefined).find((value): value is string => value !== undefined)
  const rootName = typeof records[0]?.name === 'string' ? records[0].name : ''
  const rootMessage = typeof records[0]?.message === 'string' ? records[0].message : String(error)
  const causeMessage = records.slice(1).map((record) => typeof record.message === 'string' ? record.message : undefined).find((value): value is string => value !== undefined)
  const hasSocketCause = records.slice(1).some((record) => record.name === 'SocketError' || (typeof record.message === 'string' && /socket|connection|timed out|timeout/i.test(record.message)))
  const retryable = (code !== undefined && RETRYABLE_NETWORK_CODES.has(code))
    || (rootName === 'TypeError' && rootMessage === 'fetch failed' && hasSocketCause)
  return { code, message: causeMessage ?? rootMessage, retryable }
}

function networkFailure(path: string, attempts: number, error: unknown): Error {
  const details = networkErrorDetails(error)
  return new Error(`Pages fetch failed: ${path}\nattempts: ${attempts}\ncause: ${details.code ?? 'unknown'}\nmessage: ${details.message}`, { cause: error })
}

export async function fetchBytesNoCache(base: string, path: string, options: FetchBytesOptions = {}): Promise<FetchedBytes> {
  const fetcher = options.fetch ?? fetch
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((complete) => setTimeout(complete, milliseconds)))
  for (let attempt = 1; attempt <= RETRY_DELAYS.length + 1; attempt += 1) {
    try {
      const response = await fetcher(pageUrl(base, path), { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } })
      if (!response.ok) throw new Error(`Pages file unavailable: ${path} (HTTP ${response.status})`)
      return { response, bytes: await response.arrayBuffer() }
    } catch (error) {
      const details = networkErrorDetails(error)
      if (!details.retryable) throw error
      if (attempt === RETRY_DELAYS.length + 1) throw networkFailure(path, attempt, error)
      console.warn(`Transient network error while fetching ${path} (${details.code ?? details.message}); retrying ${attempt + 1}/${RETRY_DELAYS.length + 1}...`)
      await sleep(RETRY_DELAYS[attempt - 1])
    }
  }
  throw new Error(`Pages fetch failed: ${path}`)
}

export async function verifyContentFile(base: string, file: Pick<ContentManifestFile, 'path' | 'bytes' | 'sha256'>, options?: FetchBytesOptions): Promise<void> {
  const { bytes } = await fetchBytesNoCache(base, `/${file.path}`, options)
  const actualHash = sha256(bytes)
  if (bytes.byteLength !== file.bytes || actualHash !== file.sha256) throw new Error(`Pages content verification failed: ${file.path}; expected ${file.bytes} bytes / ${file.sha256}, got ${bytes.byteLength} bytes / ${actualHash}`)
}

async function main(): Promise<void> {
  const base = argument('--url') ?? 'https://mykr-ysteinsk.github.io/myriad-atlas'
  const appVersion = argument('--app-version')
  const contentVersion = argument('--content-version')
  if (!appVersion || !contentVersion) throw new Error('Both --app-version and --content-version are required.')

  const payloads = new Map<string, string>()
  for (const path of ['/', '/manifest.webmanifest', '/_generated/app-changelog.json', '/_generated/knowledge-changelog.json', '/_generated/catalog.json', '/_generated/knowledge-map.json']) {
    const { bytes } = await fetchBytesNoCache(base, path)
    const text = new TextDecoder().decode(bytes)
    payloads.set(path, text)
  }
  const appLog = JSON.parse(payloads.get('/_generated/app-changelog.json') ?? '') as { current_version?: unknown }
  const knowledgeLog = JSON.parse(payloads.get('/_generated/knowledge-changelog.json') ?? '') as { current_version?: unknown }
  const catalog = JSON.parse(payloads.get('/_generated/catalog.json') ?? '') as { content_version?: unknown }
  if (appLog.current_version !== appVersion) throw new Error('Pages app changelog version does not match the requested app version.')
  if (knowledgeLog.current_version !== contentVersion || catalog.content_version !== contentVersion) throw new Error('Pages knowledge runtime versions do not match the requested knowledge version.')

  const serviceWorker = await fetchBytesNoCache(base, '/sw.js')
  const serviceWorkerText = new TextDecoder().decode(serviceWorker.bytes)
  if (!isJavaScriptMime(serviceWorker.response.headers.get('content-type'))) throw new Error(`Service Worker has an invalid Content-Type: ${serviceWorker.response.headers.get('content-type') ?? 'missing'}`)
  if (/^\s*(?:<!doctype html|<html\b)/i.test(serviceWorkerText)) throw new Error('Service Worker response is HTML instead of JavaScript.')

  const { bytes: manifestBytes } = await fetchBytesNoCache(base, '/_generated/content-manifest.json')
  let manifestValue: unknown
  try { manifestValue = JSON.parse(new TextDecoder().decode(manifestBytes)) } catch { throw new Error('Content manifest is not valid JSON.') }
  const manifest = await validatePagesManifest(manifestValue, contentVersion)
  if (manifest.content_version !== catalog.content_version || manifest.content_version !== knowledgeLog.current_version) throw new Error('Pages content manifest, catalog, and knowledge changelog versions are inconsistent.')

  for (const file of manifest.files) {
    await verifyContentFile(base, file)
  }
  console.log('Pages release verification passed.')
}

const isDirectExecution = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isDirectExecution) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
