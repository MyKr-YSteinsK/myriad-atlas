import type { RuntimeNode } from './compile-node'

export interface RuntimeQaIndex {
  schema_version: 1
  content_version: string
  chains: Array<{
    chain_id: string
    root_node_id: string
    answers: Array<{
      node_id: string
      parent_node_id: string | null
      prompt: string
      title: string
      source_content_version: string
      node_path: string
    }>
  }>
}

export function compileQaIndex(nodes: RuntimeNode[], contentVersion: string): RuntimeQaIndex {
  const byChain = new Map<string, RuntimeNode[]>()
  for (const node of nodes.filter((entry) => entry.qa)) {
    byChain.set(node.qa!.chain_id, [...(byChain.get(node.qa!.chain_id) ?? []), node])
  }
  const chains = [...byChain].sort(([left], [right]) => left.localeCompare(right)).map(([chainId, entries]) => {
    const byParent = new Map(entries.map((entry) => [entry.qa!.parent_node_id, entry]))
    const ordered: RuntimeNode[] = []
    let current = byParent.get(null)
    while (current) {
      ordered.push(current)
      current = byParent.get(current.id)
    }
    if (ordered.length !== entries.length) throw new Error(`QA chain ${chainId} is not linear`)
    return {
      chain_id: chainId,
      root_node_id: ordered[0].qa!.root_node_id,
      answers: ordered.map((node) => ({
        node_id: node.id,
        parent_node_id: node.qa!.parent_node_id,
        prompt: node.qa!.prompt,
        title: node.title,
        source_content_version: node.qa!.source_content_version,
        node_path: `_generated/nodes/${node.id}.json`,
      })),
    }
  })
  return { schema_version: 1, content_version: contentVersion, chains }
}
