import { APP_VERSION } from '../../lib/content-version'
import { ContentClientError } from '../../lib/errors'
import type { ContentRepository } from '../../lib/content-client'

/** Shared app-data smoke loader used before an active content pointer is committed. */
export async function loadAppData(repository: ContentRepository, signal?: AbortSignal) {
  const [catalog, taxonomy, routes, qaIndex, manifest, appChangelog, knowledgeChangelog] = await Promise.all([
    repository.loadCatalog(signal),
    repository.loadTaxonomy(signal),
    repository.loadRoutesIndex(signal),
    repository.loadQaIndex(signal),
    repository.loadContentManifest(signal),
    repository.loadAppChangelog(signal),
    repository.loadKnowledgeChangelog(signal),
  ])
  if (manifest.content_version !== catalog.content_version || appChangelog.current_version !== APP_VERSION || knowledgeChangelog.current_version !== catalog.content_version) {
    throw new ContentClientError('application', '运行时版本元数据不一致。')
  }
  return { catalog, taxonomy, routes, qaIndex, manifest, appChangelog, knowledgeChangelog }
}
