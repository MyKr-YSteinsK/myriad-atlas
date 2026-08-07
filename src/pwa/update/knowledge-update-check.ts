import { localState } from '../../app/state/local-state'
import { basePath } from '../../lib/base-path'
import { compareContentVersions } from '../../lib/content-version'
import { knowledgeFingerprint } from '../../lib/knowledge-fingerprint'
import { readActivePointer, type ContentCacheStorage } from '../content-cache'
import { ContentDownloadManager, isDownloadManifest, sha256, type ManifestPayload } from '../download/content-download'

const DEFAULT_COOLDOWN_MS = 12 * 60 * 60 * 1000

export type KnowledgeUpdateStatus = 'cooldown' | 'offline' | 'invalid-manifest' | 'first-download-available' | 'up-to-date' | 'update-available' | 'downgrade-blocked' | 'fingerprint-conflict'
export interface KnowledgeUpdateCheck {
  status: KnowledgeUpdateStatus
  checked_at: string
  manifest?: ManifestPayload['manifest']
  fingerprint?: string
  knowledge_fingerprint?: string
  artifact_snapshot_changed?: boolean
  message: string
}

export interface KnowledgeUpdateCheckerDependencies {
  download: ContentDownloadManager
  cacheStorage: ContentCacheStorage
  now?: () => Date
  cooldownMs?: number
}

function isRecent(value: unknown, now: Date, cooldownMs: number): boolean {
  if (!value || typeof value !== 'object' || !('checked_at' in value) || typeof value.checked_at !== 'string') return false
  const checked = Date.parse(value.checked_at)
  return Number.isFinite(checked) && checked <= now.getTime() && now.getTime() - checked < cooldownMs
}

export class KnowledgeUpdateChecker {
  private readonly now: NonNullable<KnowledgeUpdateCheckerDependencies['now']>
  private readonly cooldownMs: number

  constructor(private readonly dependencies: KnowledgeUpdateCheckerDependencies) {
    this.now = dependencies.now ?? (() => new Date())
    this.cooldownMs = dependencies.cooldownMs ?? DEFAULT_COOLDOWN_MS
  }

  async check(options: { manual?: boolean } = {}): Promise<KnowledgeUpdateCheck> {
    const now = this.now()
    const checked_at = now.toISOString()
    if (!options.manual && isRecent(await localState.getAppMeta('offline.last-check'), now, this.cooldownMs)) {
      return { status: 'cooldown', checked_at, message: '近期已检查过知识更新。' }
    }
    let payload: ManifestPayload
    try {
      payload = await this.dependencies.download.fetchNetworkManifest()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'network-failure'
      const status: KnowledgeUpdateStatus = message.startsWith('manifest-') ? 'invalid-manifest' : 'offline'
      const result = { status, checked_at, message: status === 'offline' ? 'Knowledge update check needs a network connection.' : 'The network manifest is invalid.' } as KnowledgeUpdateCheck
      await localState.mirrorAppMeta('offline.last-check', result)
      return result
    }
    const active = await readActivePointer(this.dependencies.cacheStorage)
    let result: KnowledgeUpdateCheck
    if (!active) {
      result = { status: 'first-download-available', checked_at, manifest: payload.manifest, fingerprint: payload.fingerprint, knowledge_fingerprint: await knowledgeFingerprint(payload.manifest), message: 'Knowledge is available for a first complete download.' }
    } else {
      const comparison = compareContentVersions(active.content_version, payload.manifest.content_version)
      const networkKnowledgeFingerprint = await knowledgeFingerprint(payload.manifest)
      if (comparison === 'older') result = { status: 'update-available', checked_at, manifest: payload.manifest, fingerprint: payload.fingerprint, knowledge_fingerprint: networkKnowledgeFingerprint, message: 'A newer knowledge version is available.' }
      else if (comparison === 'newer') result = { status: 'downgrade-blocked', checked_at, manifest: payload.manifest, fingerprint: payload.fingerprint, knowledge_fingerprint: networkKnowledgeFingerprint, message: 'The network knowledge version is older and was not offered.' }
      else {
        const activeManifest = await this.activeManifest(active.cache_name, active.manifest_fingerprint, active.content_version)
        if (!activeManifest) result = { status: 'invalid-manifest', checked_at, manifest: payload.manifest, fingerprint: payload.fingerprint, knowledge_fingerprint: networkKnowledgeFingerprint, message: 'The active content manifest is invalid.' }
        else {
          const activeKnowledgeFingerprint = await knowledgeFingerprint(activeManifest)
          const artifactSnapshotChanged = active.manifest_fingerprint !== payload.fingerprint
          result = activeKnowledgeFingerprint === networkKnowledgeFingerprint
            ? { status: 'up-to-date', checked_at, manifest: payload.manifest, fingerprint: payload.fingerprint, knowledge_fingerprint: networkKnowledgeFingerprint, artifact_snapshot_changed: artifactSnapshotChanged, message: artifactSnapshotChanged ? '线上构建快照与本地副本不同；知识内容一致。' : '已是最新知识。' }
            : { status: 'fingerprint-conflict', checked_at, manifest: payload.manifest, fingerprint: payload.fingerprint, knowledge_fingerprint: networkKnowledgeFingerprint, message: '同一知识版本对应不同知识内容。请发布新的知识版本后再更新。' }
        }
      }
    }
    await localState.mirrorAppMeta('offline.last-check', result)
    return result
  }

  private async activeManifest(cacheName: string, fingerprint: string, version: string): Promise<ManifestPayload['manifest'] | undefined> {
    if (!(await this.dependencies.cacheStorage.keys()).includes(cacheName)) return undefined
    const response = await (await this.dependencies.cacheStorage.open(cacheName)).match(basePath('_generated/content-manifest.json'))
    if (!response) return undefined
    const bytes = await response.arrayBuffer()
    if (await sha256(bytes) !== fingerprint) return undefined
    try {
      const manifest: unknown = JSON.parse(new TextDecoder().decode(bytes))
      return isDownloadManifest(manifest) && manifest.content_version === version ? manifest : undefined
    } catch {
      return undefined
    }
  }
}
