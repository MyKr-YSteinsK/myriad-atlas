import { rm } from 'node:fs/promises'
import { close, createIndex } from 'pagefind'
import type { RuntimeNode } from './compile-node'
import type { CatalogRecord } from './compile-catalog'
import { generatedRoot, PROJECT_BASE_PATH } from './config'
import { writeJson } from './write-json'

export async function buildSearch(nodes: RuntimeNode[], records: CatalogRecord[], outputRoot = generatedRoot): Promise<void> {
  const output = `${outputRoot}/pagefind`
  await rm(output, { recursive: true, force: true })
  if (nodes.length === 0) {
    await writeJson(`${outputRoot}/search-status.json`, { schema_version: 1, available: false, reason: 'empty-corpus' })
    return
  }
  await rm(`${outputRoot}/search-status.json`, { force: true })
  const service = await createIndex({ forceLanguage: 'zh' })
  if (!service.index || service.errors.length > 0) throw new Error(`Pagefind index creation failed: ${service.errors.join('; ')}`)
  try {
    const nodesById = new Map(nodes.map((node) => [node.id, node]))
    for (const record of records) {
      const node = nodesById.get(record.id)
      if (!node) throw new Error(`Search record node is missing: ${record.id}`)
      const added = await service.index.addCustomRecord({
        url: `${PROJECT_BASE_PATH}#/node/${encodeURIComponent(record.id)}`,
        language: 'zh',
        content: [record.title, record.summary, ...record.takeaways, node.plain_text].join('\n'),
        meta: { title: record.title, summary: record.summary, domain: record.domain_name, course: record.course_name, node_id: record.id, kind: record.kind },
        filters: { domain_id: [record.domain_id], course_id: [record.course_id], tags: record.tags, kind: [record.kind] },
      })
      if (added.errors.length > 0) throw new Error(`Pagefind record ${record.id} failed: ${added.errors.join('; ')}`)
    }
    const written = await service.index.writeFiles({ outputPath: output })
    if (written.errors.length > 0) throw new Error(`Pagefind output failed: ${written.errors.join('; ')}`)
  } finally {
    await close()
  }
}
