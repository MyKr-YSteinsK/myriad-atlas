import type { CatalogRecord, RuntimeQaIndex } from '../../content/types'
import { localState } from '../state/local-state'
import type { LocalQuestionChain, QuestionDraft } from '../state/reader-db'

export function allocateChainId(qaIndex: RuntimeQaIndex, localChains: LocalQuestionChain[]): string | undefined {
  const used = new Set([
    ...qaIndex.chains.map((chain) => chain.chain_id),
    ...qaIndex.chains.flatMap((chain) => chain.answers.map((answer) => answer.node_id)),
    ...localChains.map((chain) => chain.chain_id),
    ...localChains.map((chain) => chain.reserved_first_answer_id),
  ])
  for (let value = 1; value <= 9999; value += 1) {
    const id = `qa-${String(value).padStart(4, '0')}`
    if (!used.has(id)) return id
  }
  return undefined
}

function timestamp(): string { return new Date().toISOString() }
function validateQuestion(question: string): string {
  const value = question.trim()
  if (!value) throw new Error('问题不能为空')
  if (value.length > 5000) throw new Error('问题过长')
  return value
}

export async function createQuestionChain(
  source: CatalogRecord,
  qaIndex: RuntimeQaIndex,
  question: string,
): Promise<{ chain: LocalQuestionChain; draft: QuestionDraft }> {
  const localChains = await localState.listQuestionChains()
  const id = allocateChainId(qaIndex, localChains)
  if (!id) throw new Error('qa-0001 至 qa-9999 已用尽，需要扩展规范')
  const root = source.kind === 'qa'
    ? qaIndex.chains.find((chain) => chain.answers.some((answer) => answer.node_id === source.id))?.root_node_id
    : source.id
  if (!root) throw new Error('QA 来源链异常，无法确定 root_node_id')
  const now = timestamp()
  const chain: LocalQuestionChain = {
    chain_id: id, root_node_id: root, reserved_first_answer_id: id,
    status: 'awaiting-import', created_at: now, updated_at: now,
  }
  const draft: QuestionDraft = {
    draft_id: `${id}:initial`, chain_id: id, root_node_id: root, parent_node_id: null,
    question: validateQuestion(question), source_title: source.title, source_domain_id: source.domain_id,
    source_domain_name: source.domain_name, source_course_id: source.course_id, source_course_name: source.course_name,
    source_path: source.source_path, source_content_version: qaIndex.content_version, status: 'awaiting-import',
    copied_at: null, created_at: now, updated_at: now,
  }
  await localState.createQuestionChain(chain, draft)
  return { chain, draft }
}

export async function createUnknownQuestionChain(
  source: CatalogRecord,
  qaIndex: RuntimeQaIndex,
  question: string,
): Promise<{ chain: LocalQuestionChain; draft: QuestionDraft }> {
  const localChains = await localState.listQuestionChains()
  const id = allocateChainId(qaIndex, localChains)
  if (!id) throw new Error('qa-0001 至 qa-9999 已用尽，需要扩展规范')
  const root = source.kind === 'qa'
    ? qaIndex.chains.find((chain) => chain.answers.some((answer) => answer.node_id === source.id))?.root_node_id
    : source.id
  if (!root) throw new Error('QA 来源链异常，无法确定 root_node_id')
  const now = timestamp()
  const chain: LocalQuestionChain = {
    chain_id: id, root_node_id: root, reserved_first_answer_id: id,
    status: 'awaiting-import', created_at: now, updated_at: now,
  }
  const draft: QuestionDraft = {
    draft_id: `${id}:initial`, chain_id: id, root_node_id: root, parent_node_id: null,
    question: validateQuestion(question), source_title: source.title, source_domain_id: source.domain_id,
    source_domain_name: source.domain_name, source_course_id: source.course_id, source_course_name: source.course_name,
    source_path: source.source_path, source_content_version: qaIndex.content_version, status: 'awaiting-import',
    copied_at: null, created_at: now, updated_at: now,
  }
  await localState.createUnknownQuestionChain(source.id, question, chain, draft)
  return { chain, draft }
}

export async function createFollowUp(
  chain: LocalQuestionChain,
  source: CatalogRecord,
  qaIndex: RuntimeQaIndex,
  question: string,
  unknown?: { nodeId: string; note: string },
): Promise<QuestionDraft> {
  const formal = qaIndex.chains.find((entry) => entry.chain_id === chain.chain_id)
  const parent = formal?.answers.at(-1)
  if (!parent) throw new Error('继续追问必须已有正式答案')
  const pending = (await localState.listQuestionDrafts()).find((draft) => draft.chain_id === chain.chain_id
    && (draft.status === 'editing' || draft.status === 'awaiting-import'))
  if (pending) throw new Error('该问题链已有尚未导入的追问')
  const now = timestamp()
  const draft: QuestionDraft = {
    draft_id: `${chain.chain_id}:${now}`, chain_id: chain.chain_id, root_node_id: chain.root_node_id,
    parent_node_id: parent.node_id, question: validateQuestion(question), source_title: source.title,
    source_domain_id: source.domain_id, source_domain_name: source.domain_name, source_course_id: source.course_id,
    source_course_name: source.course_name, source_path: source.source_path,
    source_content_version: qaIndex.content_version, status: 'awaiting-import', copied_at: null,
    created_at: now, updated_at: now,
  }
  await localState.saveFollowUp({ ...chain, status: 'awaiting-import', updated_at: now }, draft, unknown && { node_id: unknown.nodeId, note: unknown.note })
  return draft
}

export async function reconcileQuestionChains(qaIndex: RuntimeQaIndex): Promise<void> {
  const [chains, drafts] = await Promise.all([localState.listQuestionChains(), localState.listQuestionDrafts()])
  for (const chain of chains) {
    const formal = qaIndex.chains.find((entry) => entry.chain_id === chain.chain_id)
    if (!formal) continue
    const pending = drafts.find((draft) => draft.chain_id === chain.chain_id && draft.status === 'awaiting-import')
    if (formal.root_node_id !== chain.root_node_id || formal.answers[0]?.node_id !== chain.reserved_first_answer_id) {
      if (chain.status !== 'id-conflict') await localState.saveQuestionChain({ ...chain, status: 'id-conflict', updated_at: timestamp() })
      continue
    }
    if (!pending) continue
    const matches = pending.parent_node_id === null
      ? formal.answers.some((answer) => answer.node_id === chain.reserved_first_answer_id && answer.parent_node_id === null)
      : formal.answers.some((answer) => answer.parent_node_id === pending.parent_node_id)
    if (matches) {
      const now = timestamp()
      await localState.updateQuestionBinding(
        { ...chain, status: 'answered', updated_at: now },
        { ...pending, status: 'resolved', updated_at: now },
      )
    }
  }
}

export function buildGenerationRequest(draft: QuestionDraft): string {
  return [
    '项目：万象回廊 · MyKr',
    '公开仓库：https://github.com/MyKr-YSteinsK/myriad-atlas',
    `来源标题：${draft.source_title}`,
    `永久节点 ID：${draft.root_node_id}`,
    `一级领域：${draft.source_domain_id} / ${draft.source_domain_name}`,
    `课程：${draft.source_course_id} / ${draft.source_course_name}`,
    `当前仓库相对路径：${draft.source_path}`,
    `当前知识库版本：${draft.source_content_version}`,
    `chain_id：${draft.chain_id}`,
    `root_node_id：${draft.root_node_id}`,
    `parent_node_id：${draft.parent_node_id ?? 'null'}`,
    `用户问题：${draft.question}`,
    '',
    '交付要求：先读取仓库中的完整原知识及同链正式解答；生成具有新增价值且不重复原文的答案；使用严格 Frontmatter + Markdown；输出可由统一脚本导入的正式知识 ZIP；不要先在聊天中粘贴整篇正式答案；不得新增领域或课程；保持 chain_id、root_node_id、parent_node_id；新 QA 节点 ID 由生产对话读取最新仓库后分配，初始链第一答案必须使用已预留 ID。',
  ].join('\n')
}
