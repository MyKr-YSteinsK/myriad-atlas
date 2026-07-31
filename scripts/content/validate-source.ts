import { readFile } from 'node:fs/promises'
import { basename, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import type { ValidateFunction } from 'ajv'
import { parseDocument } from 'yaml'
import { defaultContentWorkspace, type ContentWorkspace } from './config'
import { issue, type ContentIssue } from './errors'
import { parseFrontmatter, FrontmatterParseError } from './parse-frontmatter'
import { findFiles, relativePosix } from './paths'

export interface TaxonomyCourse { id: string; name: string }
export interface TaxonomyDomain { id: string; name: string; courses: TaxonomyCourse[] }
export interface Taxonomy { schema_version: 1; domains: TaxonomyDomain[] }
export interface QaMetadata {
  chain_id: string
  root_node_id: string
  parent_node_id: string | null
  source_content_version: string
  prompt: string
}
export interface SourceNodeData {
  id: string
  title: string
  domain_id: string
  course_id: string
  summary: string
  takeaways: string[]
  tags?: string[]
  prerequisites?: string[]
  related?: string[]
  self_check?: Array<{ question: string; answer: string }>
  qa?: QaMetadata
}
export interface SourceNode {
  sourcePath: string
  absolutePath: string
  body: string
  data: SourceNodeData
  sequence: number
}
export interface RouteUnit { node_id: string; role: 'core' | 'optional' | 'anchor'; order: number }
export interface SourceRoute {
  id: string
  code: string
  name: string
  summary: string
  stages: Array<{ id: string; name: string; summary: string; modules: Array<{ id: string; name: string; summary: string; units: RouteUnit[] }> }>
  sourcePath: string
}
export interface ValidationResult {
  issues: ContentIssue[]
  taxonomy?: Taxonomy
  nodes: SourceNode[]
  routes: SourceRoute[]
}

function addSchemaIssues(
  target: ContentIssue[],
  validator: ValidateFunction,
  sourcePath: string,
  value: unknown,
  nodeId?: string,
): boolean {
  if (validator(value)) return true
  for (const error of validator.errors ?? []) {
    target.push(issue('error', 'SCHEMA_INVALID', sourcePath, `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`, nodeId))
  }
  return false
}

async function loadJsonSchema(workspace: ContentWorkspace, name: string): Promise<object> {
  return JSON.parse(await readFile(resolve(workspace.schemasRoot, 'source', name), 'utf8')) as object
}

function parseYamlText(input: string, sourcePath: string, issues: ContentIssue[]): unknown {
  const document = parseDocument(input, { prettyErrors: true, uniqueKeys: true })
  if (document.errors.length > 0 || document.warnings.length > 0) {
    for (const error of [...document.errors, ...document.warnings]) {
      issues.push(issue('error', 'YAML_PARSE', sourcePath, error.message))
    }
    return undefined
  }
  return document.toJS()
}

function addTaxonomyRules(taxonomy: Taxonomy, issues: ContentIssue[], sourcePath: string): void {
  const domainIds = new Set<string>()
  const courseIds = new Set<string>()
  for (const domain of taxonomy.domains) {
    if (domainIds.has(domain.id)) issues.push(issue('error', 'TAXONOMY_DOMAIN_DUPLICATE', sourcePath, `Duplicate domain id: ${domain.id}`))
    domainIds.add(domain.id)
    if (domain.name.includes('_')) issues.push(issue('error', 'TAXONOMY_NAME_INVALID', sourcePath, `Domain name cannot contain _: ${domain.name}`))
    for (const course of domain.courses) {
      if (courseIds.has(course.id)) issues.push(issue('error', 'TAXONOMY_COURSE_DUPLICATE', sourcePath, `Duplicate course id: ${course.id}`))
      courseIds.add(course.id)
      if (course.name.includes('_')) issues.push(issue('error', 'TAXONOMY_NAME_INVALID', sourcePath, `Course name cannot contain _: ${course.name}`))
    }
  }
  const frozen = [
    { domainId: 'knowledge-roaming', domainName: '知识漫游', courseId: 'knowledge-roaming-pool', courseName: '知识漫游池' },
    { domainId: 'personal-qa', domainName: '个人问答', courseId: 'question-answer-library', courseName: '问题解答库' },
  ]
  for (const entry of frozen) {
    const domain = taxonomy.domains.find((candidate) => candidate.id === entry.domainId)
    const course = domain?.courses.find((candidate) => candidate.id === entry.courseId)
    if (domain?.name !== entry.domainName || course?.name !== entry.courseName) {
      issues.push(issue('error', 'TAXONOMY_FROZEN_MISMATCH', sourcePath, `Frozen taxonomy must be ${entry.domainName}/${entry.courseName} (${entry.domainId}/${entry.courseId})`))
    }
  }
}

function bodyLinesWithoutFences(body: string): string[] {
  let inFence = false
  return body.split('\n').filter((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      return false
    }
    return !inFence
  })
}

function canonicalPath(value: string): string {
  return value.normalize('NFC').toLocaleLowerCase('en-US')
}

export function findPathNormalizationCollisions(paths: string[]): string[][] {
  const groups = new Map<string, string[]>()
  for (const path of paths) {
    const key = canonicalPath(path.replaceAll('\\', '/'))
    groups.set(key, [...(groups.get(key) ?? []), path])
  }
  return [...groups.values()].filter((entries) => entries.length > 1)
}

function addNodePathRules(node: SourceNode, taxonomy: Taxonomy, workspace: ContentWorkspace, issues: ContentIssue[]): void {
  const parts = relative(workspace.contentRoot, node.absolutePath).replaceAll('\\', '/').split('/')
  const fileName = parts.at(-1) ?? ''
  const invalidWindows = /[<>:"/\\|?*]/
  if (parts.length !== 3 || parts.some((part) => invalidWindows.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(part))) {
    issues.push(issue('error', 'SOURCE_PATH_INVALID', node.sourcePath, 'Source path does not follow the Windows-safe domain/course/file layout', node.data.id))
    return
  }
  const [domainName, courseName] = parts
  const domain = taxonomy.domains.find((entry) => entry.name === domainName)
  const course = domain?.courses.find((entry) => entry.name === courseName)
  if (!domain || !course || node.data.domain_id !== domain.id || node.data.course_id !== course.id) {
    issues.push(issue('error', 'SOURCE_TAXONOMY_PATH_MISMATCH', node.sourcePath, 'Frontmatter IDs must match the taxonomy directory names', node.data.id))
  }

  const special = domain?.id === 'knowledge-roaming' || domain?.id === 'personal-qa'
  const expected = special
    ? /^((?:000[1-9]|00[1-9][0-9]|0[1-9][0-9]{2}|[1-9][0-9]{3}))-(.+)_([^_]+)_([^_]+)\.md$/
    : /^(0[1-9]|[1-9][0-9])-(.+)_([^_]+)_([^_]+)\.md$/
  const match = expected.exec(fileName)
  if (!match || match[3] !== domainName || match[4] !== courseName) {
    issues.push(issue('error', 'SOURCE_FILENAME_INVALID', node.sourcePath, 'Filename must match its domain and course directory', node.data.id))
  }
  if (domain?.id === 'personal-qa' && !/^qa-(?:000[1-9]|00[1-9][0-9]|0[1-9][0-9]{2}|[1-9][0-9]{3})$/.test(node.data.id)) {
    issues.push(issue('error', 'QA_ID_INVALID', node.sourcePath, 'Personal QA nodes require a qa-0001 through qa-9999 ID', node.data.id))
  }
  if (domain?.id !== 'personal-qa' && (node.data.id.startsWith('qa-') || node.data.qa)) {
    issues.push(issue('error', 'QA_LOCATION_INVALID', node.sourcePath, 'QA metadata is only valid for personal QA nodes', node.data.id))
  }
  if (domain?.id === 'personal-qa' && !node.data.qa) {
    issues.push(issue('error', 'QA_METADATA_MISSING', node.sourcePath, 'Personal QA nodes require qa metadata', node.data.id))
  }
}

function addNodeBodyRules(node: SourceNode, workspace: ContentWorkspace, issues: ContentIssue[]): void {
  const lines = bodyLinesWithoutFences(node.body)
  if (lines.some((line) => /^# (?!#)/.test(line))) {
    issues.push(issue('error', 'MARKDOWN_H1_FORBIDDEN', node.sourcePath, 'Node body must not contain an H1', node.data.id))
  }
  if (lines.some((line) => /^\s*<\/?[a-z][^>]*>/i.test(line))) {
    issues.push(issue('error', 'MARKDOWN_RAW_HTML', node.sourcePath, 'Raw HTML is not allowed in node Markdown', node.data.id))
  }
  const images = [...node.body.matchAll(/!\[([^\]]*)]\(([^)\s]+)(?:\s+[^)]*)?\)/g)]
  for (const image of images) {
    const alt = image[1].trim()
    const url = image[2]
    const mediaPath = resolve(workspace.mediaRoot, url.replace(/^\/media\//, ''))
    if (!alt || !url.startsWith('/media/') || relative(workspace.mediaRoot, mediaPath).startsWith('..')) {
      issues.push(issue('error', 'MEDIA_REFERENCE_INVALID', node.sourcePath, 'Images need alt text and an in-repository /media/ path', node.data.id))
    }
  }
}

async function addMissingMediaIssues(nodes: SourceNode[], workspace: ContentWorkspace, issues: ContentIssue[]): Promise<void> {
  const { access } = await import('node:fs/promises')
  for (const node of nodes) {
    for (const image of node.body.matchAll(/!\[[^\]]*]\(([^)\s]+)(?:\s+[^)]*)?\)/g)) {
      const url = image[1]
      if (!url.startsWith('/media/')) continue
      try {
        await access(resolve(workspace.mediaRoot, url.slice('/media/'.length)))
      } catch {
        issues.push(issue('error', 'MEDIA_MISSING', node.sourcePath, `Referenced media is missing: ${url}`, node.data.id))
      }
    }
  }
}

function addCrossNodeRules(nodes: SourceNode[], issues: ContentIssue[]): void {
  const byId = new Map<string, SourceNode>()
  for (const node of nodes) {
    if (byId.has(node.data.id)) issues.push(issue('error', 'NODE_ID_DUPLICATE', node.sourcePath, `Duplicate node id: ${node.data.id}`, node.data.id))
    byId.set(node.data.id, node)
  }
  for (const node of nodes) {
    const prerequisites = node.data.prerequisites ?? []
    const related = node.data.related ?? []
    for (const ref of [...prerequisites, ...related]) {
      if (ref === node.data.id) issues.push(issue('error', 'NODE_SELF_REFERENCE', node.sourcePath, `Node cannot reference itself: ${ref}`, node.data.id))
      else if (!byId.has(ref)) issues.push(issue('error', 'NODE_REFERENCE_MISSING', node.sourcePath, `Referenced node is missing: ${ref}`, node.data.id))
    }
    for (const ref of prerequisites) {
      if (related.includes(ref)) issues.push(issue('error', 'NODE_REFERENCE_OVERLAP', node.sourcePath, `Reference cannot be both prerequisite and related: ${ref}`, node.data.id))
    }
  }

  const qaNodes = nodes.filter((node) => node.data.qa)
  const children = new Map<string, SourceNode[]>()
  for (const node of qaNodes) {
    const qa = node.data.qa!
    if (!/^qa-(?:000[1-9]|00[1-9][0-9]|0[1-9][0-9]{2}|[1-9][0-9]{3})$/.test(qa.chain_id)) {
      issues.push(issue('error', 'QA_CHAIN_ID_INVALID', node.sourcePath, `Invalid QA chain id: ${qa.chain_id}`, node.data.id))
    }
    const root = byId.get(qa.root_node_id)
    if (!root) issues.push(issue('error', 'QA_ROOT_MISSING', node.sourcePath, `QA root is missing: ${qa.root_node_id}`, node.data.id))
    else if (root.data.qa) issues.push(issue('error', 'QA_ROOT_INVALID', node.sourcePath, 'QA root must be a non-QA source node', node.data.id))
    if (qa.parent_node_id) {
      const parent = byId.get(qa.parent_node_id)
      if (!parent?.data.qa) issues.push(issue('error', 'QA_PARENT_MISSING', node.sourcePath, `QA parent is missing: ${qa.parent_node_id}`, node.data.id))
      else {
        if (parent.data.qa.chain_id !== qa.chain_id || parent.data.qa.root_node_id !== qa.root_node_id) {
          issues.push(issue('error', 'QA_CHAIN_CROSSOVER', node.sourcePath, 'QA parent must use the same chain and root', node.data.id))
        }
        const current = children.get(qa.parent_node_id) ?? []
        current.push(node)
        children.set(qa.parent_node_id, current)
      }
    } else if (node.data.id !== qa.chain_id) {
      issues.push(issue('error', 'QA_ROOT_SEMANTICS', node.sourcePath, 'The first QA answer node id must equal chain_id', node.data.id))
    }
  }
  for (const [parent, entries] of children) {
    if (entries.length > 1) issues.push(issue('error', 'QA_CHAIN_BRANCH', entries[0].sourcePath, `QA chain branches at ${parent}`, entries[0].data.id))
  }
  for (const node of qaNodes) {
    const visited = new Set<string>()
    let current: SourceNode | undefined = node
    while (current?.data.qa?.parent_node_id) {
      if (visited.has(current.data.id)) {
        issues.push(issue('error', 'QA_CHAIN_CYCLE', node.sourcePath, 'QA chain contains a cycle', node.data.id))
        break
      }
      visited.add(current.data.id)
      current = byId.get(current.data.qa.parent_node_id)
    }
  }
}

function addSequenceAndPathRules(nodes: SourceNode[], issues: ContentIssue[]): void {
  const sequences = new Map<string, SourceNode>()
  for (const node of nodes) {
    const key = `${canonicalPath(node.data.domain_id)}/${canonicalPath(node.data.course_id)}/${node.sequence}`
    const prior = sequences.get(key)
    if (prior) {
      issues.push(issue('error', 'SOURCE_SEQUENCE_DUPLICATE', node.sourcePath, `Sequence ${node.sequence} duplicates ${prior.sourcePath}`, node.data.id))
    } else {
      sequences.set(key, node)
    }
  }
  for (const collision of findPathNormalizationCollisions(nodes.map((node) => node.sourcePath))) {
    const node = nodes.find((entry) => entry.sourcePath === collision[1])
    issues.push(issue('error', 'SOURCE_PATH_NORMALIZATION_COLLISION', collision[1], `Normalized source path collides with ${collision[0]}`, node?.data.id))
  }
}

function addRouteRules(routes: SourceRoute[], nodes: SourceNode[], issues: ContentIssue[]): Set<string> {
  const nodeIds = new Set(nodes.map((node) => node.data.id))
  const routeIds = new Set<string>()
  const routeCodes = new Set<string>()
  const anchors = new Set<string>()
  for (const route of routes) {
    if (routeIds.has(route.id)) issues.push(issue('error', 'ROUTE_ID_DUPLICATE', route.sourcePath, `Duplicate route id: ${route.id}`, route.id))
    if (routeCodes.has(route.code)) issues.push(issue('error', 'ROUTE_CODE_DUPLICATE', route.sourcePath, `Duplicate route code: ${route.code}`, route.id))
    routeIds.add(route.id)
    routeCodes.add(route.code)
    const stageIds = new Set<string>()
    for (const stage of route.stages) {
      if (stageIds.has(stage.id)) issues.push(issue('error', 'ROUTE_STAGE_DUPLICATE', route.sourcePath, `Duplicate stage id: ${stage.id}`, route.id))
      stageIds.add(stage.id)
      const moduleIds = new Set<string>()
      for (const module of stage.modules) {
        if (moduleIds.has(module.id)) issues.push(issue('error', 'ROUTE_MODULE_DUPLICATE', route.sourcePath, `Duplicate module id: ${module.id}`, route.id))
        moduleIds.add(module.id)
        const orders = new Set<number>()
        for (const unit of module.units) {
          if (!nodeIds.has(unit.node_id)) issues.push(issue('error', 'ROUTE_NODE_MISSING', route.sourcePath, `Route node is missing: ${unit.node_id}`, route.id))
          if (orders.has(unit.order)) issues.push(issue('error', 'ROUTE_ORDER_DUPLICATE', route.sourcePath, `Duplicate unit order ${unit.order} in route ${route.id}, stage ${stage.id}, module ${module.id}`, route.id))
          orders.add(unit.order)
          if (unit.role === 'anchor') anchors.add(unit.node_id)
        }
      }
    }
  }
  return anchors
}

function addAnchorRules(nodes: SourceNode[], anchorIds: Set<string>, issues: ContentIssue[]): void {
  const required = ['任务', '完成要求', '参考答案', '评分要点', '常见错误']
  for (const node of nodes.filter((entry) => anchorIds.has(entry.data.id))) {
    for (const heading of required) {
      if (!new RegExp(`^##\\s+${heading}\\s*$`, 'm').test(node.body)) {
        issues.push(issue('error', 'ANCHOR_SECTION_MISSING', node.sourcePath, `Anchor node is missing ## ${heading}`, node.data.id))
      }
    }
  }
}

function addWarnings(nodes: SourceNode[], routes: SourceRoute[], issues: ContentIssue[]): void {
  const routeNodes = new Set(routes.flatMap((route) => route.stages.flatMap((stage) => stage.modules.flatMap((module) => module.units.map((unit) => unit.node_id)))))
  for (const node of nodes) {
    if (node.data.summary.length < 12 || node.data.summary.length > 240) issues.push(issue('warning', 'SUMMARY_LENGTH', node.sourcePath, 'Summary is unusually short or long', node.data.id))
    if (!(node.data.tags?.length)) issues.push(issue('warning', 'TAGS_EMPTY', node.sourcePath, 'Node has no tags', node.data.id))
    if (!(node.data.related?.length)) issues.push(issue('warning', 'RELATED_EMPTY', node.sourcePath, 'Node has no related nodes', node.data.id))
    if (!(node.data.self_check?.length)) issues.push(issue('warning', 'SELF_CHECK_EMPTY', node.sourcePath, 'Node has no self-check', node.data.id))
    if (!routeNodes.has(node.data.id)) issues.push(issue('warning', 'ROUTE_UNASSIGNED', node.sourcePath, 'Node is not assigned to a route', node.data.id))
    if (node.body.trim().length < 80 || node.body.trim().length > 30000) issues.push(issue('warning', 'BODY_LENGTH', node.sourcePath, 'Body is unusually short or long', node.data.id))
  }
}

export async function validateSource(workspace: ContentWorkspace = defaultContentWorkspace): Promise<ValidationResult> {
  const issues: ContentIssue[] = []
  const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false })
  const [nodeSchema, taxonomySchema, routeSchema, appChangelogSchema, knowledgeChangelogSchema] = await Promise.all([
    loadJsonSchema(workspace, 'node.schema.json'),
    loadJsonSchema(workspace, 'taxonomy.schema.json'),
    loadJsonSchema(workspace, 'route.schema.json'),
    loadJsonSchema(workspace, 'app-changelog.schema.json'),
    loadJsonSchema(workspace, 'knowledge-changelog.schema.json'),
  ])
  const nodeValidator = ajv.compile(nodeSchema)
  const taxonomyValidator = ajv.compile(taxonomySchema)
  const routeValidator = ajv.compile(routeSchema)
  const appChangelogValidator = ajv.compile(appChangelogSchema)
  const knowledgeChangelogValidator = ajv.compile(knowledgeChangelogSchema)

  const taxonomySource = relativePosix(workspace.repoRoot, workspace.taxonomyPath)
  const taxonomyInput = parseYamlText(await readFile(workspace.taxonomyPath, 'utf8'), taxonomySource, issues)
  let taxonomy: Taxonomy | undefined
  if (addSchemaIssues(issues, taxonomyValidator, taxonomySource, taxonomyInput)) {
    taxonomy = taxonomyInput as Taxonomy
    addTaxonomyRules(taxonomy, issues, taxonomySource)
  }

  const appLogPath = resolve(workspace.dataRoot, 'changelog/app.yaml')
  const knowledgeLogPath = resolve(workspace.dataRoot, 'changelog/knowledge.yaml')
  const appLogSource = relativePosix(workspace.repoRoot, appLogPath)
  const knowledgeLogSource = relativePosix(workspace.repoRoot, knowledgeLogPath)
  addSchemaIssues(issues, appChangelogValidator, appLogSource, parseYamlText(await readFile(appLogPath, 'utf8'), appLogSource, issues))
  addSchemaIssues(issues, knowledgeChangelogValidator, knowledgeLogSource, parseYamlText(await readFile(knowledgeLogPath, 'utf8'), knowledgeLogSource, issues))

  const nodes: SourceNode[] = []
  for (const absolutePath of await findFiles(workspace.contentRoot, '.md')) {
    const sourcePath = relativePosix(workspace.repoRoot, absolutePath)
    try {
      const parsed = parseFrontmatter((await readFile(absolutePath, 'utf8')).replaceAll('\r\n', '\n'))
      const valid = addSchemaIssues(issues, nodeValidator, sourcePath, parsed.data)
      if (!valid) continue
      const data = parsed.data as unknown as SourceNodeData
      const sequence = Number.parseInt(basename(absolutePath), 10)
      const node = { sourcePath, absolutePath, body: parsed.body, data, sequence }
      nodes.push(node)
      if (taxonomy) addNodePathRules(node, taxonomy, workspace, issues)
      addNodeBodyRules(node, workspace, issues)
    } catch (error) {
      const message = error instanceof FrontmatterParseError || error instanceof Error ? error.message : 'Unknown frontmatter error'
      issues.push(issue('error', 'FRONTMATTER_PARSE', sourcePath, message))
    }
  }
  addSequenceAndPathRules(nodes, issues)
  await addMissingMediaIssues(nodes, workspace, issues)
  addCrossNodeRules(nodes, issues)

  const routes: SourceRoute[] = []
  for (const absolutePath of await findFiles(workspace.routesRoot, '.yaml')) {
    const sourcePath = relativePosix(workspace.repoRoot, absolutePath)
    const routeInput = parseYamlText(await readFile(absolutePath, 'utf8'), sourcePath, issues)
    if (!addSchemaIssues(issues, routeValidator, sourcePath, routeInput)) continue
    routes.push({ ...(routeInput as Omit<SourceRoute, 'sourcePath'>), sourcePath })
  }
  const anchors = addRouteRules(routes, nodes, issues)
  addAnchorRules(nodes, anchors, issues)
  addWarnings(nodes, routes, issues)
  return { issues, taxonomy, nodes, routes }
}

function printResult(result: ValidationResult): void {
  const errors = result.issues.filter((entry) => entry.severity === 'error')
  const warnings = result.issues.filter((entry) => entry.severity === 'warning')
  for (const entry of result.issues) {
    const label = entry.nodeId ? ` [${entry.nodeId}]` : ''
    console.log(`${entry.severity.toUpperCase()} ${entry.code} ${entry.sourcePath}${label}: ${entry.message}`)
  }
  console.log(`Scanned ${result.nodes.length} nodes and ${result.routes.length} routes; ${warnings.length} warnings.`)
  if (errors.length > 0) process.exitCode = 1
}

const isDirectExecution = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isDirectExecution) {
  validateSource().then(printResult).catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
