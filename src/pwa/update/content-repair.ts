import type { OfflineJob } from '../../app/state/reader-db'
import { type ContentCacheStorage } from '../content-cache'
import { ContentDownloadManager } from '../download/content-download'
import { verifyActiveContent, type ActiveContentVerification } from './content-integrity'

export class ContentRepairManager {
  constructor(private readonly download: ContentDownloadManager, private readonly cacheStorage: ContentCacheStorage) {}

  /** Stages a replacement cache; it never writes into an active cache. */
  async stageRepair(options: { confirmLowSpace?: boolean; expectedContentVersion?: string } = {}): Promise<{ verification: ActiveContentVerification; job?: OfflineJob }> {
    const verification = await verifyActiveContent(this.cacheStorage, options.expectedContentVersion)
    if (verification.status === 'healthy') return { verification }
    const job = await this.download.start({
      confirmLowSpace: options.confirmLowSpace,
      reuseActiveFiles: Boolean(verification.pointer),
      forceCandidate: true,
    })
    return { verification, job }
  }
}
