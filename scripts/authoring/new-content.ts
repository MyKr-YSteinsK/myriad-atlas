import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import { authoringPath, fail, posixRelative, readNodeId, regularFiles } from './common'

type DraftKind = 'node' | 'roaming'
interface Taxonomy { domains: Array<{ id: string; name: string; courses: Array<{ id: string; name: string }> }> }
export interface CreateDraftOptions { repositoryRoot?: string; workspace: string; kind: DraftKind; id: string; title: string; domain?: string; course?: string }
export interface DraftResult { path: string; domainName: string; courseName: string; sequence: number }

function args(): Record<string, string> {
  const result: Record<string, string> = {}
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index]; const value = process.argv[index + 1]
    if (!key?.startsWith('--') || !value || value.startsWith('--')) fail('参数必须使用 --name value')
    result[key.slice(2)] = value
  }
  return result
}

function safeTitle(value: string): string {
  const title = value.trim()
  if (!title || /[<>:"/\\|?*_]/.test(title) || /[. ]$/.test(title)) fail('标题包含不适合作为文件名的字符')
  return title
}

async function taxonomy(root: string): Promise<Taxonomy> {
  const value = parse(await readFile(resolve(root, 'src/data/taxonomy/taxonomy.yaml'), 'utf8')) as Taxonomy
  if (!Array.isArray(value?.domains)) fail('taxonomy 无效')
  return value
}

async function assertNodeId(root: string, workspace: string, id: string): Promise<void> {
  const schema = JSON.parse(await readFile(resolve(root, 'schemas/source/node.schema.json'), 'utf8')) as { properties?: { id?: { pattern?: string } } }
  const pattern = schema.properties?.id?.pattern
  if (!pattern || !(new RegExp(pattern).test(id))) fail('ID 不符合当前 node Schema')
  const tombstones = JSON.parse(await readFile(resolve(root, 'generated/content-tombstones.json'), 'utf8')) as { node_ids?: unknown }
  if (Array.isArray(tombstones.node_ids) && tombstones.node_ids.includes(id)) fail('ID 已被 tombstone 保留，不能复用')
  const roots = [resolve(root, 'src/content'), resolve(workspace, 'src/content')]
  for (const contentRoot of roots) for (const path of await regularFiles(contentRoot)) {
    if (path.endsWith('.md') && await readNodeId(path) === id) fail('ID 已存在于正式内容或 authoring workspace')
  }
}

async function nextSequence(root: string, workspace: string, domainName: string, courseName: string, roaming: boolean): Promise<number> {
  const used = new Set<number>()
  for (const directory of [resolve(root, 'src/content', domainName, courseName), resolve(workspace, 'src/content', domainName, courseName)]) {
    for (const path of await regularFiles(directory)) {
      const match = /^(\d+)-/.exec(basename(path))
      if (match) used.add(Number.parseInt(match[1], 10))
    }
  }
  const limit = roaming ? 9999 : 99
  for (let value = 1; value <= limit; value += 1) if (!used.has(value)) return value
  fail('课程序号已耗尽')
}

export async function createDraft(options: CreateDraftOptions): Promise<DraftResult> {
  const root = resolve(options.repositoryRoot ?? process.cwd())
  const workspace = authoringPath(root, options.workspace)
  const title = safeTitle(options.title)
  const sourceTaxonomy = await taxonomy(root)
  const fixed = options.kind === 'roaming'
    ? { domain: sourceTaxonomy.domains.find((entry) => entry.id === 'knowledge-roaming'), courseId: 'knowledge-roaming-pool' }
    : { domain: sourceTaxonomy.domains.find((entry) => entry.id === options.domain), courseId: options.course }
  const domain = fixed.domain
  const course = domain?.courses.find((entry) => entry.id === fixed.courseId)
  if (!domain || !course) fail('domain 或 course 不存在，或 course 不属于 domain')
  if (domain.id === 'personal-qa') fail('QA 节点不能由 content:new 生成')
  await assertNodeId(root, workspace, options.id)
  const sequence = await nextSequence(root, workspace, domain.name, course.name, options.kind === 'roaming')
  const prefix = String(sequence).padStart(options.kind === 'roaming' ? 4 : 2, '0')
  const path = resolve(workspace, 'src/content', domain.name, course.name, `${prefix}-${title}_${domain.name}_${course.name}.md`)
  const content = `---\nid: ${options.id}\ntitle: ${title}\ndomain_id: ${domain.id}\ncourse_id: ${course.id}\nsummary: TODO\ntakeaways:\n  - TODO\ntags: []\nself_check:\n  - question: TODO\n    answer: TODO\n---\n\n## 概览\n\nTODO\n\n## 正文\n\nTODO\n`
  await mkdir(resolve(workspace, 'src/content', domain.name, course.name), { recursive: true })
  await writeFile(path, content, { encoding: 'utf8', flag: 'wx' })
  return { path: posixRelative(root, path), domainName: domain.name, courseName: course.name, sequence }
}

async function main(): Promise<void> {
  const values = args()
  if (Object.keys(values).length) {
    const result = await createDraft({ workspace: values.workspace ?? '', kind: values.kind as DraftKind, id: values.id ?? '', title: values.title ?? '', domain: values.domain, course: values.course })
    console.log(`草稿已创建：${result.path}\n领域：${result.domainName}；课程：${result.courseName}\n草稿已创建；当前仍包含 TODO，不能作为正式 batch 发布。`)
    return
  }
  const prompt = createInterface({ input, output })
  try {
    const workspace = await prompt.question('workspace（inbox/authoring/<batch-id>）：')
    const kind = await prompt.question('类型（node 或 roaming）：') as DraftKind
    const id = await prompt.question('稳定英文 ID：')
    const title = await prompt.question('标题：')
    const domain = kind === 'node' ? await prompt.question('domain ID：') : undefined
    const course = kind === 'node' ? await prompt.question('course ID：') : undefined
    const result = await createDraft({ workspace, kind, id, title, domain, course })
    console.log(`草稿已创建：${result.path}\n草稿已创建；当前仍包含 TODO，不能作为正式 batch 发布。`)
  } finally { prompt.close() }
}

const isDirectExecution = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isDirectExecution) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
