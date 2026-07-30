import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import { parse } from 'yaml'
import { generatedRoot, repoRoot, schemasRoot } from './config'
import { compileAnswerMarkdown, compileMarkdown, type TocEntry } from './compile-markdown'
import type { Taxonomy, SourceNode, ValidationResult } from './validate-source'
import { validateSource } from './validate-source'

export interface RuntimeNode {
  schema_version: 1
  content_version: string
  id: string
  title: string
  domain_id: string
  domain_name: string
  course_id: string
  course_name: string
  summary: string
  takeaways: string[]
  tags: string[]
  prerequisites: string[]
  related: string[]
  self_check: Array<{ question: string; answer_html: string }>
  body_html: string
  toc: TocEntry[]
  plain_text: string
  media: string[]
  source_path: string
  sequence: number
  qa?: SourceNode['data']['qa']
}

async function contentVersion(): Promise<string> {
  const log = parse(await readFile(resolve(repoRoot, 'src/data/changelog/knowledge.yaml'), 'utf8')) as { current_version?: unknown }
  if (typeof log.current_version !== 'string' || !log.current_version) throw new Error('Knowledge changelog has no current_version')
  return log.current_version
}

function labels(taxonomy: Taxonomy, node: SourceNode): { domainName: string; courseName: string } {
  const domain = taxonomy.domains.find((entry) => entry.id === node.data.domain_id)
  const course = domain?.courses.find((entry) => entry.id === node.data.course_id)
  if (!domain || !course) throw new Error(`Taxonomy labels missing for ${node.data.id}`)
  return { domainName: domain.name, courseName: course.name }
}

export async function compileNode(node: SourceNode, taxonomy: Taxonomy, version: string): Promise<RuntimeNode> {
  const compiled = await compileMarkdown(node.body)
  const { domainName, courseName } = labels(taxonomy, node)
  const selfCheck = await Promise.all((node.data.self_check ?? []).map(async (entry) => ({
    question: entry.question,
    answer_html: await compileAnswerMarkdown(entry.answer),
  })))
  return {
    schema_version: 1,
    content_version: version,
    id: node.data.id,
    title: node.data.title,
    domain_id: node.data.domain_id,
    domain_name: domainName,
    course_id: node.data.course_id,
    course_name: courseName,
    summary: node.data.summary,
    takeaways: node.data.takeaways,
    tags: node.data.tags ?? [],
    prerequisites: node.data.prerequisites ?? [],
    related: node.data.related ?? [],
    self_check: selfCheck,
    body_html: compiled.html,
    toc: compiled.toc,
    plain_text: compiled.plainText,
    media: compiled.media,
    source_path: node.sourcePath,
    sequence: node.sequence,
    ...(node.data.qa ? { qa: node.data.qa } : {}),
  }
}

async function replaceNodesDirectory(tempDirectory: string): Promise<void> {
  const target = resolve(generatedRoot, 'nodes')
  const backup = `${target}.previous`
  await rm(backup, { recursive: true, force: true })
  try {
    await rename(target, backup)
  } catch (error: unknown) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
  }
  try {
    await rename(tempDirectory, target)
    await rm(backup, { recursive: true, force: true })
  } catch (error) {
    await rm(target, { recursive: true, force: true })
    try { await rename(backup, target) } catch { /* no previous output to restore */ }
    throw error
  }
}

export async function buildNodes(result?: ValidationResult): Promise<RuntimeNode[]> {
  const validation = result ?? await validateSource()
  const errors = validation.issues.filter((entry) => entry.severity === 'error')
  if (errors.length > 0 || !validation.taxonomy) throw new Error(errors.map((entry) => `${entry.code}: ${entry.message}`).join('\n') || 'Taxonomy validation failed')
  const version = await contentVersion()
  const schema = JSON.parse(await readFile(resolve(schemasRoot, 'runtime/node.schema.json'), 'utf8')) as object
  const validator = new Ajv2020({ allErrors: true, strict: true }).compile(schema)
  const nodes = await Promise.all([...validation.nodes].sort((left, right) => left.sourcePath.localeCompare(right.sourcePath)).map(
    (node) => compileNode(node, validation.taxonomy!, version),
  ))
  for (const node of nodes) {
    const nodeId = node.id
    if (!validator(node)) throw new Error(`Runtime node schema failed for ${nodeId}: ${validator.errors?.[0]?.message ?? 'unknown error'}`)
  }
  await mkdir(generatedRoot, { recursive: true })
  const tempDirectory = resolve(generatedRoot, `.nodes-${process.pid}`)
  await rm(tempDirectory, { recursive: true, force: true })
  await mkdir(tempDirectory)
  try {
    for (const node of nodes) {
      await writeFile(resolve(tempDirectory, `${node.id}.json`), `${JSON.stringify(node, null, 2)}\n`, 'utf8')
    }
    await replaceNodesDirectory(tempDirectory)
  } catch (error) {
    await rm(tempDirectory, { recursive: true, force: true })
    throw error
  }
  return nodes
}

if (import.meta.url === `file:///${process.argv[1].replaceAll('\\', '/')}`) {
  buildNodes().then((nodes) => console.log(`Compiled ${nodes.length} nodes.`)).catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
