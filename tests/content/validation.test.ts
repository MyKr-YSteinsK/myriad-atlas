import { cp, mkdtemp, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import Ajv2020 from 'ajv/dist/2020.js'
import { afterEach, describe, expect, it } from 'vitest'
import { parse, stringify } from 'yaml'
import { createContentWorkspace } from '../../scripts/content/config'
import { parseFrontmatter } from '../../scripts/content/parse-frontmatter'
import { findPathNormalizationCollisions, validateSource } from '../../scripts/content/validate-source'

const repoRoot = process.cwd()
const validFixtureRoot = resolve(repoRoot, 'tests/fixtures/valid-corpus')
const temporaryRoots: string[] = []
interface FixtureRoute {
  id: string
  code: string
  stages: Array<{
    modules: Array<{
      units: Array<{ node_id: string }>
    }>
  }>
}

async function replace(path: string, search: string | RegExp, replacement: string): Promise<void> {
  const source = await readFile(path, 'utf8')
  await writeFile(path, source.replace(search, replacement), 'utf8')
}

async function prepareInvalidFixture(kind: string): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'myriad-atlas-fixture-'))
  temporaryRoots.push(root)
  await cp(validFixtureRoot, root, { recursive: true })
  const content = resolve(root, 'src/content')
  const normalOne = resolve(content, '基础领域/核心课程/01-普通一_基础领域_核心课程.md')
  const normalTwo = resolve(content, '基础领域/核心课程/02-普通二_基础领域_核心课程.md')
  const anchor = resolve(content, '基础领域/核心课程/03-综合任务_基础领域_核心课程.md')
  const roamingOne = resolve(content, '知识漫游/知识漫游池/0001-漫游一_知识漫游_知识漫游池.md')
  const qaOne = resolve(content, '个人问答/问题解答库/0001-初始解答_个人问答_问题解答库.md')
  const qaTwo = resolve(content, '个人问答/问题解答库/0002-后续解答_个人问答_问题解答库.md')
  const route = resolve(root, 'src/data/routes/fixture-route.yaml')

  const mutateRoute = async (mutation: (value: FixtureRoute) => void): Promise<void> => {
    const value = parse(await readFile(route, 'utf8')) as FixtureRoute
    mutation(value)
    await writeFile(route, stringify(value), 'utf8')
  }

  if (kind === 'duplicate-node-id') await replace(normalTwo, 'id: normal-two', 'id: normal-one')
  if (kind === 'duplicate-sequence') await rename(normalTwo, resolve(content, '基础领域/核心课程/01-普通二_基础领域_核心课程.md'))
  if (kind === 'path-taxonomy-mismatch') await replace(normalOne, 'course_id: core-course', 'course_id: question-answer-library')
  if (kind === 'missing-reference') await replace(normalOne, 'related: [normal-two]', 'related: [missing-node]')
  if (kind === 'missing-media') await unlink(resolve(root, 'public/media/fixture.svg'))
  if (kind === 'anchor-sections') await replace(anchor, '## 常见错误', '## 其他说明')
  if (kind === 'route-order') await replace(route, 'order: 3', 'order: 2')
  if (kind === 'qa-cycle') await replace(qaOne, 'parent_node_id: null', 'parent_node_id: qa-0002')
  if (kind === 'qa-branch') {
    const branch = (await readFile(qaTwo, 'utf8'))
      .replace('id: qa-0002', 'id: qa-0003')
      .replace('title: Fixture 后续解答', 'title: Fixture 分叉解答')
    await writeFile(resolve(content, '个人问答/问题解答库/0003-分叉解答_个人问答_问题解答库.md'), branch, 'utf8')
  }
  if (kind === 'qa-root-semantics') {
    await replace(qaOne, 'id: qa-0001', 'id: qa-0003')
    await replace(qaTwo, 'parent_node_id: qa-0001', 'parent_node_id: qa-0003')
  }
  if (kind === 'special-sequence-zero') {
    await rename(roamingOne, resolve(content, '知识漫游/知识漫游池/0000-漫游一_知识漫游_知识漫游池.md'))
  }
  if (kind === 'self-reference') await replace(normalOne, 'related: [normal-two]', 'related: [normal-one]')
  if (kind === 'reference-overlap') await replace(normalTwo, 'related: [anchor-one]', 'related: [normal-one]')
  if (kind === 'route-id-duplicate' || kind === 'route-code-duplicate') {
    const second = parse(await readFile(route, 'utf8')) as FixtureRoute
    if (kind === 'route-code-duplicate') second.id = 'fixture-route-two'
    else second.code = 'FX02'
    await writeFile(resolve(root, 'src/data/routes/fixture-route-two.yaml'), stringify(second), 'utf8')
  }
  if (kind === 'route-stage-duplicate') await mutateRoute((value) => value.stages.push(structuredClone(value.stages[0])))
  if (kind === 'route-module-duplicate') await mutateRoute((value) => value.stages[0].modules.push(structuredClone(value.stages[0].modules[0])))
  if (kind === 'route-node-missing') await mutateRoute((value) => { value.stages[0].modules[0].units[0].node_id = 'missing-node' })
  if (kind === 'qa-root-missing') await replace(qaOne, 'root_node_id: normal-one', 'root_node_id: missing-node')
  if (kind === 'qa-root-invalid') await replace(qaOne, 'root_node_id: normal-one', 'root_node_id: qa-0001')
  if (kind === 'qa-parent-missing') await replace(qaTwo, 'parent_node_id: qa-0001', 'parent_node_id: qa-9999')
  if (kind === 'qa-chain-crossover') await replace(qaTwo, 'chain_id: qa-0001', 'chain_id: qa-0002')
  if (kind === 'qa-metadata-missing') {
    await replace(qaOne, /\nqa:\n[\s\S]*?[ ]{2}prompt: Fixture 初始问题/, '')
  }
  if (kind === 'qa-location-invalid') {
    const qaBlock = (await readFile(qaOne, 'utf8')).match(/\nqa:\n[\s\S]*?[ ]{2}prompt: Fixture 初始问题/)?.[0] ?? ''
    await replace(normalOne, '\n---\n## 正文', `${qaBlock}\n---\n## 正文`)
  }
  if (kind === 'taxonomy-frozen-name') {
    const taxonomy = resolve(root, 'src/data/taxonomy/taxonomy.yaml')
    await replace(taxonomy, 'name: 知识漫游', 'name: 漫游知识')
  }
  if (kind === 'path-normalization-collision') {
    const source = await readFile(normalTwo, 'utf8')
    await writeFile(resolve(content, '基础领域/核心课程/04-é_基础领域_核心课程.md'), source.replace('id: normal-two', 'id: unicode-one'), 'utf8')
    await writeFile(resolve(content, '基础领域/核心课程/04-é_基础领域_核心课程.md'), source.replace('id: normal-two', 'id: unicode-two'), 'utf8')
  }
  return root
}

describe('content source contracts', () => {
  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('accepts the empty formal content library', async () => {
    const result = await validateSource()

    expect(result.nodes).toHaveLength(0)
    expect(result.routes).toHaveLength(0)
    expect(result.issues.filter((entry) => entry.severity === 'error')).toEqual([])
  })

  it('accepts the non-empty fixture corpus and preserves route summaries', async () => {
    const result = await validateSource(createContentWorkspace(validFixtureRoot, resolve(repoRoot, 'schemas')))

    expect(result.issues.filter((entry) => entry.severity === 'error')).toEqual([])
    expect(result.nodes).toHaveLength(7)
    expect(result.routes[0].stages[0]).toMatchObject({
      summary: 'APP_FIXTURE_ONLY 阶段摘要',
      modules: [{ summary: 'APP_FIXTURE_ONLY 模块摘要' }],
    })
    expect(result.issues.filter((entry) => entry.severity === 'warning').map((entry) => `${entry.code}:${entry.nodeId}`)).toEqual([
      'ROUTE_UNASSIGNED:qa-0001',
      'BODY_LENGTH:qa-0001',
      'ROUTE_UNASSIGNED:qa-0002',
      'BODY_LENGTH:qa-0002',
      'BODY_LENGTH:normal-two',
      'ROUTE_UNASSIGNED:roaming-one',
      'BODY_LENGTH:roaming-one',
      'ROUTE_UNASSIGNED:roaming-two',
      'BODY_LENGTH:roaming-two',
    ])
  })

  it.each([
    ['self-reference', 'NODE_SELF_REFERENCE'],
    ['reference-overlap', 'NODE_REFERENCE_OVERLAP'],
    ['route-id-duplicate', 'ROUTE_ID_DUPLICATE'],
    ['route-code-duplicate', 'ROUTE_CODE_DUPLICATE'],
    ['route-stage-duplicate', 'ROUTE_STAGE_DUPLICATE'],
    ['route-module-duplicate', 'ROUTE_MODULE_DUPLICATE'],
    ['route-node-missing', 'ROUTE_NODE_MISSING'],
    ['qa-root-missing', 'QA_ROOT_MISSING'],
    ['qa-root-invalid', 'QA_ROOT_INVALID'],
    ['qa-parent-missing', 'QA_PARENT_MISSING'],
    ['qa-chain-crossover', 'QA_CHAIN_CROSSOVER'],
    ['qa-metadata-missing', 'QA_METADATA_MISSING'],
    ['qa-location-invalid', 'QA_LOCATION_INVALID'],
    ['taxonomy-frozen-name', 'TAXONOMY_FROZEN_MISMATCH'],
  ])('covers the %s contract with %s', async (kind, expectedCode) => {
    const root = await prepareInvalidFixture(kind)
    const result = await validateSource(createContentWorkspace(root, resolve(repoRoot, 'schemas')))
    expect(result.issues.map((entry) => entry.code)).toContain(expectedCode)
  })

  it('reports the exact expected code for every invalid fixture mutation', async () => {
    const invalidRoot = resolve(repoRoot, 'tests/fixtures/invalid')
    const cases = await Promise.all((await readdir(invalidRoot)).map(async (directory) => {
      const descriptor = JSON.parse(await readFile(resolve(invalidRoot, directory, 'mutation.json'), 'utf8')) as {
        kind: string
        expectedCode: string
      }
      return descriptor
    }))

    for (const fixture of cases) {
      const root = await prepareInvalidFixture(fixture.kind)
      if (fixture.kind === 'path-normalization-collision' && process.platform === 'win32') {
        expect(findPathNormalizationCollisions([
          'src/content/基础领域/核心课程/04-é_基础领域_核心课程.md',
          'SRC/content/基础领域/核心课程/04-é_基础领域_核心课程.md',
        ])).toHaveLength(1)
      }
      const result = await validateSource(createContentWorkspace(root, resolve(repoRoot, 'schemas')))
      expect(result.issues.map((entry) => entry.code), fixture.kind).toContain(fixture.expectedCode)
    }
  })

  it('normalizes Unicode and casing for Windows-safe collision checks', () => {
    expect(findPathNormalizationCollisions(['A/é.md', 'a/é.md'])).toEqual([['A/é.md', 'a/é.md']])
  })

  it('parses a frontmatter mapping and rejects duplicate YAML keys', () => {
    expect(parseFrontmatter('---\nid: example\n---\n正文').data).toEqual({ id: 'example' })
    expect(() => parseFrontmatter('---\nid: first\nid: second\n---\n正文')).toThrow(/Map keys must be unique/)
  })

  it('compiles every source schema in strict Draft 2020 mode', async () => {
    const directory = resolve(process.cwd(), 'schemas/source')
    const schemas = await Promise.all((await readdir(directory))
      .filter((file) => file.endsWith('.json'))
      .map(async (file) => JSON.parse(await readFile(resolve(directory, file), 'utf8')) as object))
    const ajv = new Ajv2020({ allErrors: true, strict: true })

    for (const schema of schemas) expect(() => ajv.compile(schema)).not.toThrow()
  })
})
