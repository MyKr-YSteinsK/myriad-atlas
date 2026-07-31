import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import { buildManifest } from './build-manifest'
import { compileCatalog } from './compile-catalog'
import { compileNodes, contentVersion } from './compile-node'
import { compileQaIndex } from './compile-qa-index'
import { compileRoutes } from './compile-routes'
import { compileTaxonomy } from './compile-taxonomy'
import { compileKnowledgeMap } from './compile-knowledge-map'
import {
  defaultContentWorkspace,
  generatedRoot,
  publicRoot,
  repoRoot,
  type ContentWorkspace,
} from './config'
import { buildSearch } from './build-search'
import { assertRuntimeSchema } from './runtime-validation'
import { validateSource } from './validate-source'
import { writeJson } from './write-json'

export type ContentBuildPoint = 'nodes' | 'catalog' | 'pagefind' | 'manifest' | 'before-switch'
export interface ContentBuildOptions {
  workspace?: ContentWorkspace
  targetRoot?: string
  publicDirectory?: string
  onPoint?: (point: ContentBuildPoint) => void | Promise<void>
}

async function swapGenerated(stagingRoot: string, targetRoot: string, publicDirectory: string): Promise<void> {
  const backupRoot = resolve(publicDirectory, `.generated-backup-${process.pid}`)
  await rm(backupRoot, { recursive: true, force: true })
  let hadPrevious = false
  try {
    await rename(targetRoot, backupRoot)
    hadPrevious = true
  } catch (error: unknown) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
  }
  try {
    await rename(stagingRoot, targetRoot)
  } catch (error) {
    if (hadPrevious) {
      try {
        await rename(backupRoot, targetRoot)
      } catch (restoreError) {
        throw new AggregateError(
          [error, restoreError],
          `Generated content switch failed and backup remains at ${backupRoot}`,
          { cause: restoreError },
        )
      }
    }
    throw error
  }
  await rm(backupRoot, { recursive: true, force: true })
}

export async function buildAllContent(options: ContentBuildOptions = {}): Promise<void> {
  const workspace = options.workspace ?? defaultContentWorkspace
  const targetRoot = options.targetRoot ?? generatedRoot
  const outputPublicRoot = options.publicDirectory ?? publicRoot
  const stagingRoot = resolve(outputPublicRoot, `.generated-staging-${process.pid}`)
  await rm(stagingRoot, { recursive: true, force: true })
  await mkdir(stagingRoot, { recursive: true })
  try {
    const validation = await validateSource(workspace)
    const errors = validation.issues.filter((entry) => entry.severity === 'error')
    if (errors.length > 0 || !validation.taxonomy) {
      throw new Error(errors.map((entry) => `${entry.code}: ${entry.message}`).join('\n') || 'Taxonomy validation failed')
    }
    const version = await contentVersion(workspace)
    const nodes = await compileNodes(validation, version, workspace)
    for (const node of nodes) await writeJson(resolve(stagingRoot, 'nodes', `${node.id}.json`), node)
    await options.onPoint?.('nodes')

    const taxonomy = compileTaxonomy(validation.taxonomy, nodes, version)
    const catalog = compileCatalog(nodes, validation.taxonomy, validation.routes, version)
    const routes = compileRoutes(validation.routes, nodes, version)
    const qaIndex = compileQaIndex(nodes, version)
    await assertRuntimeSchema('taxonomy.schema.json', taxonomy, workspace.schemasRoot)
    await assertRuntimeSchema('catalog.schema.json', catalog, workspace.schemasRoot)
    await assertRuntimeSchema('qa-index.schema.json', qaIndex, workspace.schemasRoot)
    for (const route of routes) await assertRuntimeSchema('route.schema.json', route, workspace.schemasRoot)
    await writeJson(resolve(stagingRoot, 'taxonomy.json'), taxonomy)
    await writeJson(resolve(stagingRoot, 'catalog.json'), catalog)
    await writeJson(resolve(stagingRoot, 'qa-index.json'), qaIndex)
    const knowledgeMap = compileKnowledgeMap(validation, version)
    await assertRuntimeSchema('knowledge-map.schema.json', knowledgeMap, workspace.schemasRoot)
    await writeJson(resolve(stagingRoot, 'knowledge-map.json'), knowledgeMap)
    for (const route of routes) await writeJson(resolve(stagingRoot, 'routes', `${route.id}.json`), route)
    await writeJson(resolve(stagingRoot, 'routes.json'), {
      schema_version: 1,
      content_version: version,
      routes: routes.map((route) => ({
        id: route.id,
        code: route.code,
        name: route.name,
        summary: route.summary,
        route_path: `_generated/routes/${route.id}.json`,
        core_anchor_count: route.core_anchor_count,
      })),
    })
    const appLog = parse(await readFile(resolve(workspace.dataRoot, 'changelog/app.yaml'), 'utf8'))
    const packageJson = JSON.parse(await readFile(resolve(repoRoot, 'package.json'), 'utf8')) as { version?: unknown }
    if (typeof packageJson.version !== 'string' || appLog?.current_version !== packageJson.version) {
      throw new Error('package.json version must match app changelog current_version')
    }
    const knowledgeLog = parse(await readFile(resolve(workspace.dataRoot, 'changelog/knowledge.yaml'), 'utf8'))
    await assertRuntimeSchema('app-changelog.schema.json', appLog, workspace.schemasRoot)
    await assertRuntimeSchema('knowledge-changelog.schema.json', knowledgeLog, workspace.schemasRoot)
    await writeJson(resolve(stagingRoot, 'app-changelog.json'), appLog)
    await writeJson(resolve(stagingRoot, 'knowledge-changelog.json'), knowledgeLog)
    await options.onPoint?.('catalog')

    await buildSearch(nodes, catalog.nodes, stagingRoot)
    await options.onPoint?.('pagefind')
    await buildManifest(version, stagingRoot, workspace.mediaRoot)
    await options.onPoint?.('manifest')
    await options.onPoint?.('before-switch')
    await swapGenerated(stagingRoot, targetRoot, outputPublicRoot)
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true })
    throw error
  }
}

const isDirectExecution = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isDirectExecution) {
  buildAllContent().then(() => console.log('Built runtime content artifacts.')).catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
