import { readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parse } from 'yaml'
import { buildManifest } from './build-manifest'
import { compileCatalog } from './compile-catalog'
import { contentVersion, buildNodes } from './compile-node'
import { compileRoutes } from './compile-routes'
import { compileTaxonomy } from './compile-taxonomy'
import { generatedRoot, repoRoot } from './config'
import { buildSearch } from './build-search'
import { assertRuntimeSchema } from './runtime-validation'
import { validateSource } from './validate-source'
import { writeJson } from './write-json'

export async function buildAllContent(): Promise<void> {
  const validation = await validateSource()
  const errors = validation.issues.filter((entry) => entry.severity === 'error')
  if (errors.length > 0 || !validation.taxonomy) throw new Error(errors.map((entry) => `${entry.code}: ${entry.message}`).join('\n') || 'Taxonomy validation failed')
  const nodes = await buildNodes(validation)
  const version = await contentVersion()
  const taxonomy = compileTaxonomy(validation.taxonomy, nodes, version)
  const catalog = compileCatalog(nodes, validation.taxonomy, validation.routes, version)
  const routes = compileRoutes(validation.routes, nodes, version)
  await assertRuntimeSchema('taxonomy.schema.json', taxonomy)
  await assertRuntimeSchema('catalog.schema.json', catalog)
  for (const route of routes) await assertRuntimeSchema('route.schema.json', route)
  await writeJson(resolve(generatedRoot, 'taxonomy.json'), taxonomy)
  await writeJson(resolve(generatedRoot, 'catalog.json'), catalog)
  await rm(resolve(generatedRoot, 'routes'), { recursive: true, force: true })
  for (const route of routes) await writeJson(resolve(generatedRoot, 'routes', `${route.id}.json`), route)
  await writeJson(resolve(generatedRoot, 'routes.json'), {
    schema_version: 1,
    content_version: version,
    routes: routes.map((route) => ({ id: route.id, code: route.code, name: route.name, summary: route.summary, route_path: `_generated/routes/${route.id}.json`, core_anchor_count: route.core_anchor_count })),
  })
  const knowledgeLog = parse(await readFile(resolve(repoRoot, 'src/data/changelog/knowledge.yaml'), 'utf8'))
  await writeJson(resolve(generatedRoot, 'knowledge-changelog.json'), knowledgeLog)
  await buildSearch(catalog.nodes)
  await buildManifest(version)
}

if (import.meta.url === `file:///${process.argv[1].replaceAll('\\', '/')}`) {
  buildAllContent().then(() => console.log('Built runtime content artifacts.')).catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
