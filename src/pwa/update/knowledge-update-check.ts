import { localState } from '../../app/state/local-state'
import { compareContentVersions } from '../../lib/content-version'
import { readActivePointer, type ContentCacheStorage } from '../content-cache'
import { ContentDownloadManager, type ManifestPayload } from '../download/content-download'

const DEFAULT_COOLDOWN_MS = 12 * 60 * 60 * 1000

export type KnowledgeUpdateStatus = 'cooldown' | 'offline' | 'invalid-manifest' | 'first-download-available' | 'up-to-date' | 'update-available' | 'downgrade-blocked' | 'fingerprint-conflict'
export interface KnowledgeUpdateCheck {
  status: KnowledgeUpdateStatus
  checked_at: string
  manifest?: ManifestPayload['manifest']
  fingerprint?: string
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
      return { status: 'cooldown', checked_at, message: 'A knowledge update check was completed recently.' }
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
      result = { status: 'first-download-available', checked_at, manifest: payload.manifest, fingerprint: payload.fingerprint, message: 'Knowledge is available for a first complete download.' }
    } else {
      const comparison = compareContentVersions(active.content_version, payload.manifest.content_version, active.manifest_fingerprint, payload.fingerprint)
      if (comparison === 'equal') result = { status: 'up-to-date', checked_at, manifest: payload.manifest, fingerprint: payload.fingerprint, message: 'Active knowledge is up to date.' }
      else if (comparison === 'older') result = { status: 'update-available', checked_at, manifest: payload.manifest, fingerprint: payload.fingerprint, message: 'A newer knowledge version is available.' }
      else if (comparison === 'newer') result = { status: 'downgrade-blocked', checked_at, manifest: payload.manifest, fingerprint: payload.fingerprint, message: 'The network knowledge version is older and was not offered.' }
      else result = { status: 'fingerprint-conflict', checked_at, manifest: payload.manifest, fingerprint: payload.fingerprint, message: 'The network manifest conflicts with the active version fingerprint.' }
    }
    await localState.mirrorAppMeta('offline.last-check', result)
    return result
  }
}
