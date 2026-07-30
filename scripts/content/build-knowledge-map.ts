import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { committedGeneratedRoot } from './config'
import { contentVersion } from './compile-node'
import type { SourceRoute, Taxonomy, ValidationResult } from './validate-source'
import { validateSource } from './validate-source'

function routePositions(routes: SourceRoute[]): Map<string, string[]> {
  const positions = new Map<string, string[]>()
  for (const route of routes) for (const stage of route.stages) for (const module of stage.modules) for (const unit of module.units) {
    const list = positions.get(unit.node_id) ?? []
    list.push(`${route.code} / ${stage.name} / ${module.name} / ${unit.order} (${unit.role})`)
    positions.set(unit.node_id, list)
  }
  return positions
}

export function renderKnowledgeMap(result: ValidationResult, version: string): string {
  const taxonomy = result.taxonomy as Taxonomy
  const positions = routePositions(result.routes)
  const lines = ['# 知识地图', '', '该文件由 `npm run content:map` 确定性生成，请勿手工编辑。', '']
  lines.push(`知识版本：${version}`, '')
  if (result.nodes.length === 0) lines.push('当前无正式节点。', '')
  for (const domain of taxonomy.domains) {
    lines.push(`## ${domain.name}`, '')
    for (const course of domain.courses) {
      lines.push(`### ${course.name}`, '')
      const nodes = result.nodes.filter((node) => node.data.domain_id === domain.id && node.data.course_id === course.id).sort((left, right) => left.sequence - right.sequence || left.data.id.localeCompare(right.data.id))
      if (nodes.length === 0) lines.push('当前无正式节点。', '')
      for (const node of nodes) {
        lines.push(`- ${node.data.id}｜${node.data.title}｜${node.sourcePath}｜序号 ${node.sequence}`)
        if (positions.has(node.data.id)) lines.push(`  - 路线：${positions.get(node.data.id)!.join('；')}`)
        if (node.data.prerequisites?.length) lines.push(`  - prerequisites：${node.data.prerequisites.join(', ')}`)
        if (node.data.related?.length) lines.push(`  - related：${node.data.related.join(', ')}`)
        if (node.data.qa) lines.push(`  - QA：root=${node.data.qa.root_node_id}；chain=${node.data.qa.chain_id}；parent=${node.data.qa.parent_node_id ?? '无'}`)
      }
      lines.push('')
    }
  }
  const unassigned = result.nodes.filter((node) => !positions.has(node.data.id))
  if (unassigned.length > 0) lines.push('## 未进入路线的节点', '', ...unassigned.map((node) => `- ${node.data.id}｜${node.data.title}`), '')
  while (lines.at(-1) === '') lines.pop()
  return `${lines.join('\n')}\n`
}

export async function buildKnowledgeMap(check = false): Promise<void> {
  const result = await validateSource()
  const errors = result.issues.filter((entry) => entry.severity === 'error')
  if (errors.length > 0 || !result.taxonomy) throw new Error(errors.map((entry) => entry.message).join('\n') || 'Taxonomy is invalid')
  const output = renderKnowledgeMap(result, await contentVersion())
  const outputPath = resolve(committedGeneratedRoot, 'knowledge-map.md')
  if (check) {
    const current = await readFile(outputPath, 'utf8').catch(() => '')
    if (current !== output) throw new Error('generated/knowledge-map.md is out of date; run npm run content:map')
    return
  }
  await writeFile(outputPath, output, 'utf8')
}

if (import.meta.url === `file:///${process.argv[1].replaceAll('\\', '/')}`) {
  buildKnowledgeMap(process.argv.includes('--check')).catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
