import { beforeEach, describe, expect, it } from 'vitest'
import {
  allocateChainId,
  buildGenerationRequest,
  createFollowUp,
  createQuestionChain,
  reconcileQuestionChains,
} from '../../src/app/data/question-chains'
import { localState } from '../../src/app/state/local-state'
import { readerDb, type LocalQuestionChain, type QuestionDraft } from '../../src/app/state/reader-db'
import type { CatalogRecord, RuntimeQaIndex } from '../../src/content/types'

const source: CatalogRecord = {
  id: 'source', title: '来源', domain_id: 'domain', domain_name: '领域', course_id: 'course', course_name: '课程',
  summary: '摘要', takeaways: ['要点'], tags: [], sequence: 1, source_path: 'src/content/source.md',
  kind: 'normal', node_path: '_generated/nodes/source.json', route_url: '#/node/source',
}
const emptyIndex: RuntimeQaIndex = { schema_version: 1, content_version: '2026.07.30-01', chains: [] }
const formalIndex: RuntimeQaIndex = {
  ...emptyIndex,
  chains: [{ chain_id: 'qa-0001', root_node_id: 'source', answers: [{
    node_id: 'qa-0001', parent_node_id: null, prompt: '问题', title: '答案',
    source_content_version: '2026.07.30-01', node_path: '_generated/nodes/qa-0001.json',
  }] }],
}

describe('linear question chains', () => {
  beforeEach(async () => {
    await readerDb.delete()
    await readerDb.open()
  })

  it('allocates the smallest never-used ID across formal answers and hidden local chains', () => {
    const local: LocalQuestionChain[] = [{
      chain_id: 'qa-0002', root_node_id: 'source', reserved_first_answer_id: 'qa-0002',
      status: 'hidden', created_at: '', updated_at: '',
    }]
    expect(allocateChainId(formalIndex, local)).toBe('qa-0003')
    const exhausted = Array.from({ length: 9999 }, (_, index): LocalQuestionChain => ({
      chain_id: `qa-${String(index + 1).padStart(4, '0')}`, root_node_id: 'source',
      reserved_first_answer_id: `qa-${String(index + 1).padStart(4, '0')}`,
      status: 'hidden', created_at: '', updated_at: '',
    }))
    expect(allocateChainId(emptyIndex, exhausted)).toBeUndefined()
  })

  it('allows multiple source chains but only one pending draft per chain', async () => {
    const first = await createQuestionChain(source, emptyIndex, '第一个问题')
    const second = await createQuestionChain(source, emptyIndex, '第二个问题')
    expect([first.chain.chain_id, second.chain.chain_id]).toEqual(['qa-0001', 'qa-0002'])
    await expect(createFollowUp(first.chain, source, formalIndex, '追问')).rejects.toThrow(/已有尚未导入/)
  })

  it('creates a follow-up against the latest formal answer', async () => {
    const chain: LocalQuestionChain = {
      chain_id: 'qa-0001', root_node_id: 'source', reserved_first_answer_id: 'qa-0001',
      status: 'answered', created_at: '', updated_at: '',
    }
    await localState.saveQuestionChain(chain)
    const draft = await createFollowUp(chain, source, formalIndex, '继续追问')
    expect(draft.parent_node_id).toBe('qa-0001')
  })

  it('binds matching imports and marks root conflicts without changing IDs', async () => {
    const created = await createQuestionChain(source, emptyIndex, '问题')
    await reconcileQuestionChains(formalIndex)
    expect(await readerDb.questionChains.get(created.chain.chain_id)).toMatchObject({ status: 'answered' })
    expect(await readerDb.questionDrafts.get(created.draft.draft_id)).toMatchObject({ status: 'resolved' })

    const conflict: LocalQuestionChain = {
      chain_id: 'qa-0002', root_node_id: 'other', reserved_first_answer_id: 'qa-0002',
      status: 'awaiting-import', created_at: '', updated_at: '',
    }
    const draft: QuestionDraft = { ...created.draft, draft_id: 'conflict', chain_id: 'qa-0002', root_node_id: 'other' }
    await localState.createQuestionChain(conflict, draft)
    await reconcileQuestionChains({
      ...emptyIndex, chains: [{ ...formalIndex.chains[0], chain_id: 'qa-0002', answers: [{ ...formalIndex.chains[0].answers[0], node_id: 'qa-0002' }] }],
    })
    expect(await readerDb.questionChains.get('qa-0002')).toMatchObject({ status: 'id-conflict', reserved_first_answer_id: 'qa-0002' })
  })

  it('builds a complete stable generation request', async () => {
    const { draft } = await createQuestionChain(source, emptyIndex, '怎样理解？')
    const text = buildGenerationRequest(draft)
    for (const field of ['万象回廊 · MyKr', 'github.com/MyKr-YSteinsK/myriad-atlas', '来源标题', '永久节点 ID', '一级领域', '课程', '当前仓库相对路径', '当前知识库版本', 'chain_id', 'root_node_id', 'parent_node_id', '用户问题', '正式知识 ZIP']) {
      expect(text).toContain(field)
    }
  })
})
