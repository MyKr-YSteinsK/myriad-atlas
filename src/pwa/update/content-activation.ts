import { localState } from '../../app/state/local-state'
import { loadAppData } from '../../app/data/app-data-loader'
import { contentRepository, type ContentRepository } from '../../lib/content-client'
import { searchRepository, type SearchRepository } from '../../lib/search-repository'
import { CONTENT_CACHE_MESSAGES, type ActiveContentPointer } from '../cache-protocol'
import { clearActivePointer, readActivePointer, restorePreviousPointer, type ContentCacheStorage, writeActivePointer } from '../content-cache'
import { ContentDownloadManager } from '../download/content-download'

export interface ActivationDependencies {
  cacheStorage: ContentCacheStorage
  download: ContentDownloadManager
  repository?: ContentRepository
  search?: SearchRepository
  notifyWorker?: (message: { type: string }) => Promise<void>
  smokeLoad?: () => Promise<void>
}

export async function smokeLoadContent(repository: ContentRepository): Promise<void> {
  await loadAppData(repository)
}

export class ContentActivationManager {
  private readonly repository: ContentRepository
  private readonly search: SearchRepository
  private readonly notifyWorker: NonNullable<ActivationDependencies['notifyWorker']>
  private readonly smokeLoad: () => Promise<void>

  constructor(private readonly dependencies: ActivationDependencies) {
    this.repository = dependencies.repository ?? contentRepository
    this.search = dependencies.search ?? searchRepository
    this.notifyWorker = dependencies.notifyWorker ?? (async () => undefined)
    this.smokeLoad = dependencies.smokeLoad ?? (() => smokeLoadContent(this.repository))
  }

  async activate(jobId: string): Promise<{ active: boolean; rolledBack: boolean; error?: string }> {
    const { job } = await this.dependencies.download.verifyJob(jobId)
    if (job.status !== 'ready-to-activate') throw new Error('候选内容尚未完成校验。')
    const previous = await readActivePointer(this.dependencies.cacheStorage)
    const pointer: ActiveContentPointer = {
      schema_version: 1,
      content_version: job.content_version, manifest_fingerprint: job.manifest_fingerprint,
      cache_name: job.cache_name, activated_at: new Date().toISOString(), previous_cache_name: previous?.cache_name ?? null,
    }
    try {
      await localState.saveOfflineJob({ ...job, status: 'activating', error_code: null, error_message: null, updated_at: new Date().toISOString() })
      await writeActivePointer(pointer, this.dependencies.cacheStorage)
      await localState.mirrorAppMeta('offline.active', pointer)
      await this.notifyWorker({ type: CONTENT_CACHE_MESSAGES.activated })
      this.repository.invalidate()
      this.search.reset()
      await this.smokeLoad()
      await localState.saveOfflineJob({ ...job, status: 'active', error_code: null, error_message: null, updated_at: new Date().toISOString() })
      return { active: true, rolledBack: false }
    } catch (reason) {
      try {
        if (previous) {
          await restorePreviousPointer(previous, this.dependencies.cacheStorage)
          await localState.mirrorAppMeta('offline.active', previous)
          await this.notifyWorker({ type: CONTENT_CACHE_MESSAGES.rolledBack })
        } else {
          await clearActivePointer(this.dependencies.cacheStorage)
          await localState.mirrorAppMeta('offline.active', null)
        }
      } catch {
        // Preserve the original activation failure; pointer restoration failure is independently observable in the job.
      }
      this.repository.invalidate()
      this.search.reset()
      try { await this.smokeLoad() } catch { /* The pointer has already been restored; existing UI remains usable. */ }
      const error = reason instanceof Error ? reason.message : '内容激活失败。'
      await localState.saveOfflineJob({ ...job, status: 'failed', error_code: 'activation-failed', error_message: error, updated_at: new Date().toISOString() })
      return { active: false, rolledBack: Boolean(previous), error }
    }
  }
}
