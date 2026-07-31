import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAppData } from '../data/app-data-context'
import { useLocalStateSnapshot } from '../state/use-local-state'
import { APP_VERSION } from '../../lib/content-version'
import { contentRepository } from '../../lib/content-client'
import { searchRepository } from '../../lib/search-repository'
import { isIphoneSafari, isStandalone } from '../../pwa/install-detection'
import { ContentDownloadManager, LowSpaceConfirmationRequiredError, type DownloadEstimate } from '../../pwa/download/content-download'
import { ContentActivationManager } from '../../pwa/update/content-activation'
import { KnowledgeUpdateChecker, type KnowledgeUpdateCheck } from '../../pwa/update/knowledge-update-check'
import { verifyActiveContent, type ActiveContentVerification } from '../../pwa/update/content-integrity'
import { ContentRepairManager } from '../../pwa/update/content-repair'
import { cleanupTemporaryContentCaches } from '../../pwa/update/cache-cleanup'
import { listContentCaches, readActivePointer, type ContentCacheStorage } from '../../pwa/content-cache'
import { type ActiveContentPointer } from '../../pwa/cache-protocol'
import { localState } from '../state/local-state'
import { useAppUpdate } from '../../pwa/app-update-context'
import { applyPersonalRestore, clearAllPersonalData, countCurrentPersonalData, exportPersonalBackup, getBackupReminderState, preparePersonalRestore, readPersonalBackupFile, setBackupReminderEnabled, type BackupReminderState, type PreparedRestore } from '../backup/personal-backup'

type Runtime = { storage: ContentCacheStorage; download: ContentDownloadManager; checker: KnowledgeUpdateChecker }

function browserRuntime(): Runtime | undefined {
  if (typeof caches === 'undefined') return undefined
  const storage = caches as ContentCacheStorage
  const download = new ContentDownloadManager({ cacheStorage: storage })
  return { storage, download, checker: new KnowledgeUpdateChecker({ cacheStorage: storage, download }) }
}

function workerNotifier(type: string): Promise<void> {
  try { navigator.serviceWorker?.controller?.postMessage({ type }) } catch { return Promise.reject(new Error('无法通知 Service Worker 刷新知识缓存。')) }
  return Promise.resolve()
}

function displayBytes(value: number | undefined): string {
  if (value === undefined) return '浏览器未提供估算'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KiB`
  return `${(value / 1024 / 1024).toFixed(1)} MiB`
}

function jobLabel(status: string): string {
  return ({ estimating: '正在估算空间', downloading: '正在下载', paused: '下载已暂停', failed: '下载失败', 'rollback-failed': '回滚未完成', verifying: '正在验证', 'ready-to-activate': '已验证，等待激活', activating: '正在激活', active: '已完整离线' } as Record<string, string>)[status] ?? status
}

function activeJob(jobs: ReturnType<typeof useLocalStateSnapshot>['offlineJobs']) {
  return [...jobs].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).find((job) => job.status !== 'active')
    ?? [...jobs].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]
}

export function OfflineHomeHint() {
  const local = useLocalStateSnapshot()
  const [check, setCheck] = useState<KnowledgeUpdateCheck>()
  useEffect(() => { void localState.getAppMeta<KnowledgeUpdateCheck>('offline.last-check').then(setCheck).catch(() => undefined) }, [local.offlineJobs])
  const job = activeJob(local.offlineJobs)
  if (check?.status === 'update-available') return <aside className="home-offline-hint" role="status"><p>有新的知识版本可用。</p><Link to="/me/offline">查看离线与更新</Link></aside>
  if (job?.status === 'failed') return <aside className="home-offline-hint" role="status"><p>知识下载未完成：{job.error_message || '请重试。'}</p><Link to="/me/offline">继续处理</Link></aside>
  if (!local.offlineJobs.some((entry) => entry.status === 'active')) return <aside className="home-offline-hint"><p>尚未完整下载知识库；离线阅读需要由你主动开始。</p><Link to="/me/offline">设置离线知识</Link></aside>
  return null
}

export function BackupReminder() {
  const { state } = useAppData()
  const local = useLocalStateSnapshot()
  const [reminder, setReminder] = useState<BackupReminderState>()
  const [later, setLater] = useState(false)
  const knowledgeVersion = state.status === 'ready' || state.status === 'empty' ? state.data.contentVersion : 'unknown'
  useEffect(() => { void getBackupReminderState(knowledgeVersion).then(setReminder).catch(() => undefined) }, [knowledgeVersion, local.nodeStates, local.questionChains, local.questionDrafts, local.opinions, local.pendingRemovals])
  if (!reminder?.due || later) return null
  return <aside className="home-offline-hint" role="status"><p>个人状态已有 {reminder.mutationCount} 次变更，建议导出一份本地备份。</p><Link to="/me/backups">前往备份</Link><button type="button" onClick={() => setLater(true)}>稍后</button><button type="button" onClick={() => void setBackupReminderEnabled(false).then(() => setReminder({ ...reminder, enabled: false, due: false }))}>关闭提醒</button></aside>
}

export function OfflinePage() {
  const appData = useAppData()
  const appUpdate = useAppUpdate()
  const local = useLocalStateSnapshot()
  const runtime = useMemo(() => browserRuntime(), [])
  const [check, setCheck] = useState<KnowledgeUpdateCheck>()
  const [pointer, setPointer] = useState<ActiveContentPointer>()
  const [verification, setVerification] = useState<ActiveContentVerification>()
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [lowSpace, setLowSpace] = useState<DownloadEstimate>()
  const job = activeJob(local.offlineJobs)
  const refreshPointer = useCallback(async () => {
    if (!runtime) return
    setPointer(await readActivePointer(runtime.storage))
  }, [runtime])
  useEffect(() => {
    if (!runtime) return
    let active = true
    void readActivePointer(runtime.storage).then((value) => { if (active) setPointer(value) }).catch(() => undefined)
    return () => { active = false }
  }, [runtime, local.offlineJobs])
  useEffect(() => {
    if (!runtime) return
    void runtime.checker.check().then(setCheck).catch(() => undefined)
  }, [runtime])
  const run = useCallback(async (name: string, action: () => Promise<void>) => {
    setBusy(name); setError(undefined)
    try { await action() } catch (reason) { setError(reason instanceof Error ? reason.message : '操作未完成。') } finally { setBusy(undefined); void refreshPointer() }
  }, [refreshPointer])
  const activate = (): Promise<void> => run('activate', async () => {
    if (!runtime || !job) return
    const manager = new ContentActivationManager({
      cacheStorage: runtime.storage,
      download: runtime.download,
      repository: contentRepository,
      search: searchRepository,
      notifyWorker: ({ type }) => workerNotifier(type),
      smokeLoad: async () => { if (!await appData.refresh()) throw new Error('新知识版本未通过应用数据加载验证。') },
    })
    const result = await manager.activate(job.job_id)
    if (!result.active) {
      const oldVersionVerified = result.rollback === 'succeeded' && result.pointer_restored && result.old_content_reloaded
      throw new Error(oldVersionVerified ? '知识更新失败，已重新验证旧版本仍可使用。' : result.error || '知识更新失败；请重新验证当前活动知识。')
    }
  })
  const startDownload = async (options: { confirmLowSpace?: boolean; reuseActiveFiles?: boolean; forceCandidate?: boolean } = {}): Promise<void> => {
    if (!runtime) return
    setBusy('download'); setError(undefined)
    try {
      await runtime.download.start(options)
      setLowSpace(undefined)
    } catch (reason) {
      if (reason instanceof LowSpaceConfirmationRequiredError) setLowSpace(reason.estimate)
      else setError(reason instanceof Error ? reason.message : '操作未完成。')
    } finally { setBusy(undefined); void refreshPointer() }
  }
  const currentMode = (() => {
    const standalone = typeof window !== 'undefined' && isStandalone(window.matchMedia?.('(display-mode: standalone)').matches ?? false, (navigator as Navigator & { standalone?: boolean }).standalone === true)
    return standalone ? '主屏幕 Web App' : isIphoneSafari(navigator.userAgent) ? 'iPhone Safari 标签页' : '浏览器标签页'
  })()
  return <section className="atlas-page offline-page"><p className="atlas-coordinate">LOCAL / OFFLINE</p><h1 tabIndex={-1}>离线与更新</h1>
    <dl className="offline-overview"><div><dt>运行模式</dt><dd>{currentMode}</dd></div><div><dt>应用外壳</dt><dd>{({ unsupported: '不支持或开发模式', registering: '注册中', ready: '已就绪', 'offline-ready': '离线外壳已就绪', 'update-available': '应用更新可用', activating: '正在更新', error: '注册失败' } as Record<string, string>)[appUpdate.state.status]}</dd></div><div><dt>离线知识</dt><dd>{pointer ? `已激活 ${pointer.content_version}` : '尚未完整下载'}</dd></div></dl>
    {!runtime && <p role="status">此浏览器不支持 Cache Storage，无法提供完整离线知识。</p>}
    {job && <section className="offline-card"><h2>{jobLabel(job.status)}</h2><p>{job.content_version} · {job.files_done} / {job.files_total} 个文件 · {displayBytes(job.payload_bytes_done)} / {displayBytes(job.payload_bytes_total)}（{job.payload_bytes_total ? Math.min(100, Math.round(job.payload_bytes_done / job.payload_bytes_total * 100)) : 100}%）</p><p>建议预留空间：{displayBytes(Math.max(0, job.required_storage_bytes - job.payload_bytes_total))}</p>{job.error_message && <details><summary>查看错误详情</summary><p>{job.error_message}</p></details>}</section>}
    {lowSpace && <section className="offline-card"><h2>空间接近下载所需</h2><dl className="offline-overview"><div><dt>预计下载</dt><dd>{displayBytes(lowSpace.payload_bytes_total)}</dd></div><div><dt>建议预留</dt><dd>{displayBytes(lowSpace.required_storage_bytes - lowSpace.payload_bytes_total)}</dd></div><div><dt>浏览器估算可用</dt><dd>{displayBytes(lowSpace.available)}</dd></div></dl><p>可用空间可以容纳内容本身，但不足以保留建议的安全余量；下载可能因浏览器缓存压力失败。</p><div className="offline-actions"><button type="button" disabled={Boolean(busy)} onClick={() => void startDownload({ confirmLowSpace: true })}>仍然开始</button><button type="button" disabled={Boolean(busy)} onClick={() => setLowSpace(undefined)}>取消</button></div></section>}
    {verification && <p role="status">完整性检查：{verification.status}。{verification.message}</p>}
    {check && <p role="status">知识检查：{check.message}</p>}
    {error && <p role="alert">{error}</p>}
    <div className="offline-actions">
      {!pointer && (!job || job.error_code === 'confirmation-required') && !lowSpace && <button type="button" disabled={!runtime || Boolean(busy)} onClick={() => void startDownload()}>开始完整下载</button>}
      {job?.status === 'downloading' && <button type="button" disabled={!runtime || Boolean(busy)} onClick={() => void run('pause', () => runtime!.download.pause(job.job_id))}>暂停</button>}
      {(job?.status === 'paused' || job?.status === 'failed') && job.error_code !== 'confirmation-required' && <button type="button" disabled={!runtime || Boolean(busy)} onClick={() => void run('resume', async () => { await runtime!.download.retry(job.job_id) })}>{job.status === 'paused' ? '继续' : '重试失败'}</button>}
      {(job?.status === 'paused' || job?.status === 'failed') && <button type="button" disabled={!runtime || Boolean(busy)} onClick={() => void run('abandon', () => runtime!.download.abandon(job.job_id))}>放弃此次下载</button>}
      {job?.status === 'ready-to-activate' && <button type="button" disabled={!runtime || Boolean(busy)} onClick={() => void activate()}>激活已验证版本</button>}
      <button type="button" disabled={!runtime || Boolean(busy)} onClick={() => void run('check', async () => { setCheck(await runtime!.checker.check({ manual: true })) })}>检查知识更新</button>
      {pointer && check?.status === 'update-available' && <button type="button" disabled={!runtime || Boolean(busy)} onClick={() => void run('update', async () => { await runtime!.download.start({ reuseActiveFiles: true }) })}>下载更新</button>}
      {pointer && <button type="button" disabled={!runtime || Boolean(busy)} onClick={() => void run('redownload', async () => { await runtime!.download.start({ reuseActiveFiles: true, forceCandidate: true }) })}>重新下载知识库</button>}
      {pointer && <button type="button" disabled={!runtime || Boolean(busy)} onClick={() => void run('verify', async () => { setVerification(await verifyActiveContent(runtime!.storage, appData.state.status === 'ready' || appData.state.status === 'empty' ? appData.state.data.contentVersion : undefined)) })}>重新验证当前活动指针</button>}
      {verification && verification.status !== 'healthy' && <button type="button" disabled={!runtime || Boolean(busy)} onClick={() => void run('repair', async () => { const result = await new ContentRepairManager(runtime!.download, runtime!.storage).stageRepair(); if (!result.job || result.job.status !== 'ready-to-activate') throw new Error('无法完成修复候选下载。') })}>下载修复候选</button>}
    </div>
    <p className="offline-note">下载不会在应用关闭后继续。请在主屏幕 Web App 中完成下载和个人状态记录。</p>
  </section>
}

async function cacheBytes(storage: ContentCacheStorage, names: string[]): Promise<number> {
  let total = 0
  for (const name of names) for (const request of await (await storage.open(name)).keys()) total += (await (await (await storage.open(name)).match(request))?.arrayBuffer())?.byteLength ?? 0
  return total
}

export function VersionsPage() {
  const { state } = useAppData()
  if (state.status === 'loading') return <section className="atlas-page"><h1 tabIndex={-1}>版本日志</h1><p>正在加载……</p></section>
  if (state.status === 'error') return <section className="atlas-page"><h1 tabIndex={-1}>版本日志</h1><p role="alert">{state.error.message}</p></section>
  return <section className="atlas-page versions-page"><p className="atlas-coordinate">RELEASE / LOG</p><h1 tabIndex={-1}>版本日志</h1>
    <section><h2>应用版本</h2><p>当前应用：{APP_VERSION}</p><ol>{state.data.appChangelog.entries.map((entry) => <li key={`${entry.version}-${entry.date}`}><strong>{entry.version}{entry.version === APP_VERSION ? '（当前）' : ''}</strong><span>{entry.date}</span><p>{entry.summary}</p></li>)}</ol></section>
    <section><h2>知识版本</h2><p>当前运行知识：{state.data.contentVersion}</p><ol>{state.data.knowledgeChangelog.entries.map((entry) => <li key={`${entry.version}-${entry.date}`}><strong>{entry.version}{entry.version === state.data.contentVersion ? '（当前）' : ''}</strong><span>{entry.date}</span><p>{entry.summary}</p></li>)}</ol></section>
  </section>
}

export function StoragePage() {
  const local = useLocalStateSnapshot()
  const runtime = useMemo(() => browserRuntime(), [])
  const [info, setInfo] = useState<{ usage?: number; quota?: number; content?: number; candidates?: number }>()
  const [verification, setVerification] = useState<ActiveContentVerification>()
  const [message, setMessage] = useState<string>()
  const [clearConfirm, setClearConfirm] = useState('')
  const refresh = useCallback(async () => {
    if (!runtime) return
    const estimate = await navigator.storage?.estimate?.().catch(() => undefined)
    const pointer = await readActivePointer(runtime.storage)
    const names = await listContentCaches(runtime.storage)
    const active = pointer ? [pointer.cache_name] : []
    setInfo({ usage: estimate?.usage, quota: estimate?.quota, content: await cacheBytes(runtime.storage, active), candidates: await cacheBytes(runtime.storage, names.filter((name) => !active.includes(name))) })
  }, [runtime])
  useEffect(() => {
    if (!runtime) return
    let active = true
    void (async () => {
      const estimate = await navigator.storage?.estimate?.().catch(() => undefined)
      const pointer = await readActivePointer(runtime.storage)
      const names = await listContentCaches(runtime.storage)
      const current = pointer ? [pointer.cache_name] : []
      const next = { usage: estimate?.usage, quota: estimate?.quota, content: await cacheBytes(runtime.storage, current), candidates: await cacheBytes(runtime.storage, names.filter((name) => !current.includes(name))) }
      if (active) setInfo(next)
    })()
    return () => { active = false }
  }, [runtime])
  return <section className="atlas-page storage-page"><p className="atlas-coordinate">LOCAL / STORAGE</p><h1 tabIndex={-1}>存储与修复</h1>
    <dl className="offline-overview"><div><dt>浏览器已用空间</dt><dd>{displayBytes(info?.usage)}</dd></div><div><dt>浏览器配额</dt><dd>{displayBytes(info?.quota)}</dd></div><div><dt>活动知识缓存</dt><dd>{displayBytes(info?.content)}</dd></div><div><dt>候选 / 孤儿缓存</dt><dd>{displayBytes(info?.candidates)}</dd></div><div><dt>个人 IndexedDB 记录</dt><dd>{local.nodeStates.length + local.questionChains.length + local.questionDrafts.length + local.pendingRemovals.length + local.opinions.length}</dd></div></dl>
    {verification && <p role="status">{verification.status}：{verification.message}</p>}{message && <p role="status">{message}</p>}
    <div className="offline-actions"><button type="button" disabled={!runtime} onClick={() => { if (runtime) void verifyActiveContent(runtime.storage).then(setVerification) }}>验证知识完整性</button><button type="button" disabled={!runtime} onClick={() => { if (runtime) void cleanupTemporaryContentCaches(runtime.storage).then((removed) => { setMessage(`已清理 ${removed.length} 个临时内容缓存。`); void refresh() }) }}>清理临时缓存</button><Link to="/me/offline">重新下载知识库</Link><Link to="/me/backups">备份与恢复</Link></div>
    <section className="clear-personal-data"><h2>清除全部个人数据</h2><p>建议先导出备份。此操作只删除个人状态和偏好，不删除离线知识、Service Worker 或应用外壳。</p><label>输入“清除”以确认<input value={clearConfirm} onChange={(event) => setClearConfirm(event.target.value)} /></label><button type="button" disabled={clearConfirm !== '清除'} onClick={() => void clearAllPersonalData().then(() => { setClearConfirm(''); setMessage('已清除全部个人数据；离线知识保持不变。') })}>清除个人数据</button></section>
    <p className="offline-note">清理临时缓存不会清除 active 知识、Service Worker 或个人数据。</p>
  </section>
}

export function BackupPage() {
  const { state } = useAppData()
  const local = useLocalStateSnapshot()
  const [reminder, setReminder] = useState<BackupReminderState>()
  const [message, setMessage] = useState<string>()
  const [exporting, setExporting] = useState(false)
  const [prepared, setPrepared] = useState<PreparedRestore>()
  const [restoreReady, setRestoreReady] = useState(false)
  const [currentPersonalCount, setCurrentPersonalCount] = useState(0)
  const knowledgeVersion = state.status === 'ready' || state.status === 'empty' ? state.data.contentVersion : 'unknown'
  const refresh = useCallback(() => getBackupReminderState(knowledgeVersion).then(setReminder).catch(() => undefined), [knowledgeVersion])
  useEffect(() => { void refresh() }, [refresh, local.nodeStates, local.routePositions, local.questionChains, local.questionDrafts, local.opinions, local.pendingRemovals])
  useEffect(() => { void countCurrentPersonalData().then(setCurrentPersonalCount).catch(() => undefined) }, [local.nodeStates, local.routePositions, local.questionChains, local.questionDrafts, local.opinions, local.pendingRemovals])
  const exportBackup = async (): Promise<void> => {
    setExporting(true); setMessage(undefined)
    try {
      const result = await exportPersonalBackup(knowledgeVersion)
      setMessage(result.method === 'shared' ? '已启动系统分享，备份提醒已重置。' : '已启动 JSON 下载，备份提醒已重置。')
      setRestoreReady(true)
      await refresh()
    } catch (reason) { setMessage(reason instanceof Error ? `备份未导出：${reason.message}` : '备份未导出。') } finally { setExporting(false) }
  }
  const selectRestoreFile = async (file: File | undefined): Promise<void> => {
    if (!file || state.status === 'loading' || state.status === 'error') return
    setMessage(undefined); setPrepared(undefined)
    try {
      const backup = await readPersonalBackupFile(file)
      const nodeIds = new Set(state.data.catalog.nodes.map((node) => node.id))
      const tocEntries = await Promise.all(backup.data.node_states.filter((entry) => nodeIds.has(entry.node_id)).map(async (entry) => {
        try { return [entry.node_id, new Set((await contentRepository.loadNode(entry.node_id)).toc.map((item) => item.id))] as const } catch { return [entry.node_id, new Set<string>()] as const }
      }))
      setPrepared(await preparePersonalRestore(backup, { appVersion: APP_VERSION, knowledgeVersion, nodeIds, routeIds: state.data.routes.routes.map((route) => route.id), tocIdsByNode: new Map(tocEntries), qaIndex: state.data.qaIndex }))
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : '无法读取备份文件。') }
  }
  const restore = async (): Promise<void> => {
    if (!prepared) return
    const currentCount = await countCurrentPersonalData()
    if (!restoreReady && currentCount > 0) { setCurrentPersonalCount(currentCount); setMessage('请先成功启动当前数据的备份导出，再执行恢复。'); return }
    try { await applyPersonalRestore(prepared); setPrepared(undefined); setMessage('个人数据已恢复；离线知识保持不变。'); await refresh() } catch (reason) { setMessage(reason instanceof Error ? `恢复失败：${reason.message}` : '恢复失败，原数据未改变。') }
  }
  return <section className="atlas-page backup-page"><p className="atlas-coordinate">LOCAL / BACKUP</p><h1 tabIndex={-1}>备份与恢复</h1><p>备份只包含个人状态，不包含可重新下载的正文、媒体、搜索索引、Cache Storage 或离线下载记录。</p>
    <dl className="offline-overview"><div><dt>节点状态</dt><dd>{local.nodeStates.length}</dd></div><div><dt>问题链 / 草稿</dt><dd>{local.questionChains.length} / {local.questionDrafts.length}</dd></div><div><dt>待删除 / 意见</dt><dd>{local.pendingRemovals.length} / {local.opinions.length}</dd></div><div><dt>应用 / 知识版本</dt><dd>{APP_VERSION} / {knowledgeVersion}</dd></div></dl>
    <div className="offline-actions"><button type="button" disabled={exporting} onClick={() => void exportBackup()}>{exporting ? '正在准备备份…' : '导出个人备份'}</button><button type="button" onClick={() => void setBackupReminderEnabled(!(reminder?.enabled ?? true)).then(() => void refresh())}>{reminder?.enabled === false ? '启用备份提醒' : '关闭备份提醒'}</button></div>
    {message && <p role="status">{message}</p>}
    <section className="restore-panel"><h2>恢复个人备份</h2><p>恢复会整套替换当前个人状态；离线知识和下载记录不会变化。</p><label>选择 JSON 备份文件<input type="file" accept="application/json,.json" onChange={(event) => void selectRestoreFile(event.currentTarget.files?.[0])} /></label>{prepared && <><p>备份：应用 {prepared.backup.app_version} · 知识 {prepared.backup.knowledge_version}</p><p>当前将被清除 {prepared.summary.current_clear} 条，备份将导入 {prepared.summary.imported} 条，将跳过 {Object.values(prepared.summary.skipped).reduce((total, count) => total + count, 0)} 条；将保留 {prepared.summary.offline_metadata_retained} 条离线元数据。</p>{Object.entries(prepared.summary.skipped).map(([reason, count]) => <p key={reason}>{reason}：{count}</p>)}{prepared.summary.warnings.map((warning) => <p key={warning}>{warning}</p>)}<button type="button" disabled={!restoreReady && currentPersonalCount > 0} onClick={() => void restore()}>{restoreReady || currentPersonalCount === 0 ? '确认整套替换恢复' : '请先导出当前备份'}</button></>}</section>
  </section>
}
