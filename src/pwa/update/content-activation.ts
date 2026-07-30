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

export interface ContentActivationResult {
  active: boolean
  rollback: 'not-needed' | 'succeeded' | 'failed'
  pointer_restored: boolean
  worker_notified: boolean
  old_content_reloaded: boolean
  error?: string
  rollback_error?: string
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

  async activate(jobId: string): Promise<ContentActivationResult> {
    const { job } = await this.dependencies.download.verifyJob(jobId)
    if (job.status !== 'ready-to-activate') throw new Error('候选内容尚未完成校验。')
    const previous = await readActivePointer(this.dependencies.cacheStorage)
    const pointer: ActiveContentPointer = {
      schema_version: 1,
      content_version: job.content_version, manifest_fingerprint: job.manifest_fingerprint,
      cache_name: job.cache_name, activated_at: new Date().toISOString(), previous_cache_name: previous?.cache_name ?? null,
    }
    let pointerChanged = false
    let workerNotified = false
    try {
      await localState.saveOfflineJob({ ...job, status: 'activating', error_code: null, error_message: null, updated_at: new Date().toISOString() })
      await writeActivePointer(pointer, this.dependencies.cacheStorage)
      pointerChanged = true
      await localState.mirrorAppMeta('offline.active', pointer)
      await this.notifyWorker({ type: CONTENT_CACHE_MESSAGES.activated })
      workerNotified = true
      this.repository.invalidate()
      this.search.reset()
      await this.smokeLoad()
      await localState.saveOfflineJob({ ...job, status: 'active', error_code: null, error_message: null, updated_at: new Date().toISOString() })
      return { active: true, rollback: 'not-needed', pointer_restored: false, worker_notified: true, old_content_reloaded: false }
    } catch (reason) {
      let rollback: ContentActivationResult['rollback'] = pointerChanged ? 'succeeded' : 'not-needed'
      let pointerRestored = !pointerChanged
      let rollbackError: string | undefined
      let oldContentReloaded = false
      try {
        if (pointerChanged) {
          if (previous) {
            await restorePreviousPointer(previous, this.dependencies.cacheStorage)
            await localState.mirrorAppMeta('offline.active', previous)
          } else {
            await clearActivePointer(this.dependencies.cacheStorage)
            await localState.mirrorAppMeta('offline.active', null)
          }
          pointerRestored = true
        }
      } catch (rollbackReason) {
        rollback = 'failed'
        pointerRestored = false
        rollbackError = rollbackReason instanceof Error ? rollbackReason.message : '活动指针恢复失败。'
      }
      const error = reason instanceof Error ? reason.message : '内容激活失败。'
      if (pointerChanged && pointerRestored) {
        try {
          await this.notifyWorker({ type: CONTENT_CACHE_MESSAGES.rolledBack })
          workerNotified = true
        } catch (workerReason) {
          workerNotified = false
          rollbackError = rollbackError ?? (workerReason instanceof Error ? workerReason.message : '无法通知 Service Worker 恢复活动指针。')
        }
      }
      if (previous && pointerRestored) {
        this.repository.invalidate()
        this.search.reset()
        try {
          await this.smokeLoad()
          oldContentReloaded = true
        } catch (reloadReason) {
          rollbackError = rollbackError ?? (reloadReason instanceof Error ? reloadReason.message : '旧内容重新加载失败。')
        }
      }
      const message = rollbackError ? `${error}；${rollbackError}` : error
      await localState.saveOfflineJob({
        ...job,
        status: rollback === 'failed' ? 'rollback-failed' : 'failed',
        error_code: rollback === 'failed' ? 'rollback-failed' : 'activation-failed',
        error_message: message,
        updated_at: new Date().toISOString(),
      })
      return {
        active: false, rollback, pointer_restored: pointerRestored, worker_notified: workerNotified,
        old_content_reloaded: oldContentReloaded, error, rollback_error: rollbackError,
      }
    }
  }
}
