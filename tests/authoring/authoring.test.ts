import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBatch } from '../../scripts/authoring/create-batch'
import { createDraft } from '../../scripts/authoring/new-content'
import { buildAllContent } from '../../scripts/content/build-all'
import { createContentWorkspace } from '../../scripts/content/config'
import { scanKnowledgeBatch } from '../../scripts/knowledge/scan-batch'

const roots: string[] = []

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'myriad-authoring-'))
  roots.push(root)
  for (const directory of ['src', 'schemas', 'generated'] as const) await cp(resolve(process.cwd(), directory), resolve(root, directory), { recursive: true })
  await mkdir(resolve(root, 'public/media'), { recursive: true })
  await buildAllContent({ workspace: createContentWorkspace(root, resolve(root, 'schemas')), publicDirectory: resolve(root, 'public'), targetRoot: resolve(root, 'public/_generated') })
  await mkdir(resolve(root, 'inbox/batches'), { recursive: true })
  return root
}

describe('local content authoring', () => {
  afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

  it('creates normal and roaming drafts with stable IDs and validator-compatible paths', async () => {
    const root = await fixture()
    const workspace = 'inbox/authoring/batch-20260807-001-test'
    const normal = await createDraft({ repositoryRoot: root, workspace, kind: 'node', domain: 'everyday-science', course: 'light-and-color-intro', id: 'authoring-normal', title: '作者普通节点' })
    const roaming = await createDraft({ repositoryRoot: root, workspace, kind: 'roaming', id: 'authoring-roaming', title: '作者漫游节点' })
    expect(normal.path).toBe('inbox/authoring/batch-20260807-001-test/src/content/日常科学/光与颜色入门/03-作者普通节点_日常科学_光与颜色入门.md')
    expect(roaming.path).toBe('inbox/authoring/batch-20260807-001-test/src/content/知识漫游/知识漫游池/0002-作者漫游节点_知识漫游_知识漫游池.md')
    await expect(readFile(resolve(root, normal.path), 'utf8')).resolves.toContain('id: authoring-normal')
  })

  it('creates add and replace operations accepted by the existing scanner and dry-run', async () => {
    const root = await fixture()
    const workspace = resolve(root, 'inbox/authoring/batch-20260807-001-test')
    const content = resolve(workspace, 'src/content/日常科学/光与颜色入门/03-作者工具测试_日常科学_光与颜色入门.md')
    await mkdir(resolve(content, '..'), { recursive: true })
    await writeFile(content, '---\nid: authoring-batch-node\ntitle: 作者工具测试\ndomain_id: everyday-science\ncourse_id: light-and-color-intro\nsummary: 这是一篇用于验证本地作者工作流的最小正式草稿内容。\ntakeaways:\n  - 作者工具只准备批次，不会自动 apply。\ntags:\n  - 验收\nself_check:\n  - question: 作者工具会自动发布吗？\n    answer: 不会，仍需用户显式确认。\n---\n\n## 概览\n\n这段文本足够长，用于通过最小内容校验，并验证作者工具会把草稿加入受控批次。\n\n## 正文\n\n作者先在本地工作区编写内容，再生成 ZIP 和 dry-run 报告；正式写入仍由现有知识更新流程完成。\n', 'utf8')
    const routeTarget = resolve(root, 'src/data/routes/light-and-color-intro.yaml')
    const routeDraft = resolve(workspace, 'src/data/routes/light-and-color-intro.yaml')
    await mkdir(resolve(routeDraft, '..'), { recursive: true })
    await writeFile(routeDraft, `${await readFile(routeTarget, 'utf8')}\n`, 'utf8')
    const result = await createBatch({ repositoryRoot: root, source: 'inbox/authoring/batch-20260807-001-test', batchId: 'batch-20260807-001-test', targetVersion: '2026.08.07-01', releasedOn: '2026-08-07', summary: '作者工具验收批次', git: { head: 'test', clean: true } })
    const scanned = await scanKnowledgeBatch(resolve(root, result.zipPath), { repositoryRoot: root })
    expect(scanned.manifest.operations.map((operation) => operation.action)).toEqual(['add', 'replace'])
    expect(result.confirmationToken).toMatch(/^APPLY:1:2026\.08\.07-01:/)
  })
})
