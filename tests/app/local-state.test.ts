import { beforeEach, describe, expect, it, vi } from 'vitest'
import { localState } from '../../src/app/state/local-state'
import { defaultReaderPreferences, readerDb, type QuestionDraft } from '../../src/app/state/reader-db'

describe('local state repository', () => {
  beforeEach(async () => {
    await readerDb.delete()
    await readerDb.open()
  })

  it('keeps completed and unknown independent and supports unknown undo', async () => {
    await localState.toggleCompleted('node')
    await localState.setUnknown('node', '需要追问')
    expect(await localState.getNode('node')).toMatchObject({ completed: true, unknown: true, unknown_note: '需要追问' })
    const note = await localState.clearUnknown('node')
    expect(await localState.getNode('node')).toMatchObject({ completed: true, unknown: false, unknown_note: '' })
    await localState.undoClearUnknown('node', note)
    expect(await localState.getNode('node')).toMatchObject({ completed: true, unknown: true, unknown_note: '需要追问' })
  })

  it('publishes revisions only after successful writes', async () => {
    const listener = vi.fn()
    const unsubscribe = localState.subscribe(listener)
    await localState.toggleFavorite('node')
    expect(listener).toHaveBeenCalledOnce()
    expect(localState.getRevision()).toBeGreaterThan(0)
    unsubscribe()
  })

  it('does not publish or retain a successful state when IndexedDB rejects the write', async () => {
    const before = localState.getRevision()
    const put = vi.spyOn(readerDb.nodeStates, 'put').mockRejectedValueOnce(new Error('storage failed'))
    await expect(localState.toggleCompleted('failed')).rejects.toThrow('storage failed')
    expect(localState.getRevision()).toBe(before)
    expect(await readerDb.nodeStates.get('failed')).toBeUndefined()
    put.mockRestore()
  })

  it('stores route position, uninterested state and CRUD records', async () => {
    await localState.markRoamingUninterested('roaming', '不需要')
    await localState.saveRoutePosition({ route_id: 'route', stage_id: 'stage', module_id: 'module', node_id: 'node' })
    await localState.savePendingRemoval({
      id: 'removal', kind: 'roaming-node', target_id: 'roaming', root_node_id: null,
      note: '不需要', created_at: 'created', updated_at: 'created',
    })
    await localState.saveOpinion({
      id: 'opinion', scope: 'global', route_id: null, text: '意见', created_at: 'created', updated_at: 'created',
    })
    expect(await readerDb.nodeStates.get('roaming')).toMatchObject({ uninterested: true })
    expect(await readerDb.routePositions.get('route')).toMatchObject({ node_id: 'node' })
    expect(await readerDb.pendingRemovals.get('removal')).toBeTruthy()
    expect(await readerDb.pendingRemovals.get('roaming-node:roaming')).toBeTruthy()
    expect(await readerDb.opinions.get('opinion')).toBeTruthy()
    await localState.undoRoamingUninterested('roaming')
    expect(await readerDb.nodeStates.get('roaming')).toMatchObject({ uninterested: false })
    expect(await readerDb.pendingRemovals.get('roaming-node:roaming')).toBeUndefined()
  })

  it('enforces one pending draft per question chain transactionally', async () => {
    const base: QuestionDraft = {
      draft_id: 'draft-1', chain_id: 'qa-0001', root_node_id: 'node', parent_node_id: null,
      question: '问题', source_title: '标题', source_domain_id: 'domain', source_domain_name: '领域',
      source_course_id: 'course', source_course_name: '课程', source_path: 'src/node.md',
      source_content_version: 'v', status: 'awaiting-import', copied_at: null,
      created_at: 'created', updated_at: 'created',
    }
    await localState.saveQuestionDraft(base)
    await expect(localState.saveQuestionDraft({ ...base, draft_id: 'draft-2' })).rejects.toThrow(/pending draft/)
    expect(await readerDb.questionDrafts.count()).toBe(1)
  })
  it('restores the exact hidden question-chain state and handles legacy pending records conservatively', async () => {
    const chain = { chain_id: 'qa-0001', root_node_id: 'node', reserved_first_answer_id: 'qa-0001', status: 'awaiting-import' as const, created_at: 'created', updated_at: 'created' }
    const draft: QuestionDraft = {
      draft_id: 'qa-0001:initial', chain_id: chain.chain_id, root_node_id: 'node', parent_node_id: null,
      question: '问题', source_title: '标题', source_domain_id: 'domain', source_domain_name: '领域',
      source_course_id: 'course', source_course_name: '课程', source_path: 'src/node.md', source_content_version: 'v',
      status: 'awaiting-import', copied_at: null, created_at: 'created', updated_at: 'created',
    }
    await localState.createQuestionChain(chain, draft)
    await localState.hideQuestionChain(chain.chain_id, chain.root_node_id)
    await localState.undoHiddenQuestionChain(chain.chain_id)
    expect(await readerDb.questionChains.get(chain.chain_id)).toMatchObject({ status: 'awaiting-import' })

    await readerDb.questionChains.put({ ...chain, status: 'hidden' })
    await readerDb.questionDrafts.put({ ...draft, status: 'resolved' })
    await readerDb.pendingRemovals.put({ id: `qa-chain:${chain.chain_id}`, kind: 'qa-chain', target_id: chain.chain_id, root_node_id: 'node', note: '', created_at: 'created', updated_at: 'created' })
    await localState.undoHiddenQuestionChain(chain.chain_id)
    expect(await readerDb.questionChains.get(chain.chain_id)).toMatchObject({ status: 'answered' })

    await readerDb.questionChains.put({ ...chain, status: 'hidden' })
    await readerDb.questionDrafts.delete(draft.draft_id)
    await readerDb.pendingRemovals.put({ id: `qa-chain:${chain.chain_id}`, kind: 'qa-chain', target_id: chain.chain_id, root_node_id: 'node', note: '', created_at: 'created', updated_at: 'created' })
    await expect(localState.undoHiddenQuestionChain(chain.chain_id)).rejects.toThrow(/reliable previous status/)
  })

  it('counts personal mutations once while excluding progress, routes, and offline metadata', async () => {
    expect(await localState.getMutationCount()).toBe(0)
    await localState.markRoamingUninterested('roaming', '不需要')
    expect(await localState.getMutationCount()).toBe(1)
    await localState.saveReadingProgress('roaming', 0.5, '', [])
    await localState.saveRoutePosition({ route_id: 'route', stage_id: 'stage', module_id: 'module', node_id: 'roaming' })
    await localState.saveOfflineJob({
      job_id: 'job', content_version: 'v', manifest_fingerprint: 'f'.repeat(64), cache_name: 'cache', status: 'estimating',
      bytes_total: 0, bytes_done: 0, files_total: 0, files_done: 0, current_path: null, error_code: null, error_message: null, created_at: 'now', updated_at: 'now',
    })
    expect(await localState.getMutationCount()).toBe(1)
    await localState.saveReaderPreferences({ ...defaultReaderPreferences, fontSize: 20 })
    await localState.saveAppPreference('install.guidance', true)
    expect(await localState.getMutationCount()).toBe(3)
  })
})
