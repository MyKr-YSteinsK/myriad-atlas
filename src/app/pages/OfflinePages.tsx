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
import { useAppUpdate } from '../../pwa/app-update-context'
import { applyPersonalRestore, clearAllPersonalData, countCurrentPersonalData, exportPersonalBackup, getBackupReminderState, preparePersonalRestore, readPersonalBackupFile, setBackupReminderEnabled, type BackupReminderState, type PreparedRestore } from '../backup/personal-backup'
import { shellSummary, updateSummary } from '../offline/offline-summary'
import { PageHeader } from '../components/PageHeader'
import { StateGlyph } from '../components/visual'

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

function shellGlyph(status: string): 'completed' | 'current' | 'unknown' {
  if (status === 'offline-ready') return 'completed'
  if (status === 'error') return 'unknown'
  return 'current'
}

function updateGlyph(status: string | undefined): 'completed' | 'current' | 'unknown' {
  if (status === 'update-available') return 'current'
  if (status === 'error') return 'unknown'
  return 'completed'
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
  const knowledgeVersion = pointer?.content_version ?? (appData.state.status === 'ready' || appData.state.status === 'empty' ? appData.state.data.contentVersion : '未知版本')
  const filesPercent = job?.files_total ? Math.round(job.files_done / job.files_total * 100) : 0
  const bytesPercent = job?.payload_bytes_total ? Math.round(job.payload_bytes_done / job.payload_bytes_total * 100) : 0
  return <section className="atlas-page offline-page"><PageHeader kicker="LOCAL / OFFLINE" title="离线与更新" summary="应用外壳与知识快照相互独立；完整验证后才会切换活动知识。" />
    <dl className="offline-overview offline-primary"><div><dt>应用</dt><dd><StateGlyph state={shellGlyph(appUpdate.state.status)} />{shellSummary(appUpdate.state)}<small>版本 {APP_VERSION}</small></dd></div><div><dt>知识</dt><dd><StateGlyph state={pointer ? 'completed' : 'unread'} />{knowledgeVersion}<small>{pointer ? '已完整离线' : '尚未完整离线'}</small></dd></div><div><dt>更新</dt><dd><StateGlyph state={updateGlyph(check?.status)} />{updateSummary(check)}<small>{check?.status === 'cooldown' ? '近期已检查' : check?.status === 'update-available' ? '可下载更新' : ''}</small></dd></div></dl>
    {appUpdate.state.status === 'error' && <p className="offline-card" role="status">应用离线外壳注册失败。在线浏览仍可使用。</p>}
    {!runtime && <p role="status">此浏览器不支持 Cache Storage，无法提供完整离线知识。</p>}
    {job && <section className="offline-card"><h2>{jobLabel(job.status)}</h2><p>{job.content_version} · {job.files_done} / {job.files_total} · {filesPercent}%</p><p>{displayBytes(job.payload_bytes_done)} / {displayBytes(job.payload_bytes_total)}（{bytesPercent}%）</p>{bytesPercent === 100 && job.status === 'failed' && <p>内容已传输，但仍有文件未通过验证。</p>}<p>建议预留空间：{displayBytes(Math.max(0, job.required_storage_bytes - job.payload_bytes_total))}</p>{job.error_message && <details><summary>查看错误详情</summary><p>下载未完成。有 1 个文件未通过验证。</p><p>{job.error_message}</p></details>}</section>}
    {lowSpace && <section className="offline-card"><h2>空间接近下载所需</h2><dl className="offline-overview"><div><dt>预计下载</dt><dd>{displayBytes(lowSpace.payload_bytes_total)}</dd></div><div><dt>建议预留</dt><dd>{displayBytes(lowSpace.required_storage_bytes - lowSpace.payload_bytes_total)}</dd></div><div><dt>浏览器估算可用</dt><dd>{displayBytes(lowSpace.available)}</dd></div></dl><p>可用空间可以容纳内容本身，但不足以保留建议的安全余量；下载可能因浏览器缓存压力失败。</p><div className="offline-actions"><button type="button" disabled={Boolean(busy)} onClick={() => void startDownload({ confirmLowSpace: true })}>仍然开始</button><button type="button" disabled={Boolean(busy)} onClick={() => setLowSpace(undefined)}>取消</button></div></section>}
    <div className="offline-actions">
      {!pointer && (!job || job.error_code === 'confirmation-required') && !lowSpace && <button type="button" disabled={!runtime || Boolean(busy)} onClick={() => void startDownload()}>下载完整知识库</button>}
      {job?.status === 'downloading' && <button type="button" disabled={!runtime || Boolean(busy)} onClick={() => void run('pause', () => runtime!.download.pause(job.job_id))}>暂停</button>}
      {(job?.status === 'paused' || job?.status === 'failed') && job.error_code !== 'confirmation-required' && <button type="button" disabled={!runtime || Boolean(busy)} onClick={() => void run('resume', async () => { await runtime!.download.retry(job.job_id) })}>{job.status === 'paused' ? '继续' : '重试'}</button>}
      {(job?.status === 'paused' || job?.status === 'failed') && <button type="button" disabled={!runtime || Boolean(busy)} onClick={() => void run('abandon', () => runtime!.download.abandon(job.job_id))}>放弃此次下载</button>}
      {job?.status === 'ready-to-activate' && <button type="button" disabled={!runtime || Boolean(busy)} onClick={() => void activate()}>激活已验证版本</button>}
      <button type="button" disabled={!runtime || Boolean(busy)} onClick={() => void run('check', async () => { setCheck(await runtime!.checker.check({ manual: true })) })}>检查更新</button>
      {pointer && check?.status === 'update-available' && <button type="button" disabled={!runtime || Boolean(busy)} onClick={() => void run('update', async () => { await runtime!.download.start({ reuseActiveFiles: true }) })}>下载更新</button>}
      {pointer && <button type="button" disabled={!runtime || Boolean(busy)} onClick={() => void run('redownload', async () => { await runtime!.download.start({ reuseActiveFiles: true, forceCandidate: true }) })}>重新下载</button>}
    </div>
    <details className="offline-diagnostics"><summary>高级诊断与维护</summary><p>运行模式：{currentMode}</p><p>应用外壳：{appUpdate.state.status}；Service Worker：{appUpdate.state.error ?? '无错误'}</p><p>活动指针：{pointer ? `${pointer.content_version} / ${pointer.cache_name}` : '无'}</p><p>检查结果：{check?.message ?? '尚未检查'}</p><p>完整性检查：{verification ? `${verification.status}。${verification.message}` : '尚未执行'}</p>{error && <p role="alert">{error}</p>}<div className="offline-actions">{pointer && <button type="button" disabled={!runtime || Boolean(busy)} onClick={() => void run('verify', async () => { setVerification(await verifyActiveContent(runtime!.storage, appData.state.status === 'ready' || appData.state.status === 'empty' ? appData.state.data.contentVersion : undefined)) })}>重新验证</button>}{verification && verification.status !== 'healthy' && <button type="button" disabled={!runtime || Boolean(busy)} onClick={() => void run('repair', async () => { const result = await new ContentRepairManager(runtime!.download, runtime!.storage).stageRepair(); if (!result.job || result.job.status !== 'ready-to-activate') throw new Error('无法完成修复候选下载。') })}>下载修复候选</button>}</div></details>
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
  return <section className="atlas-page versions-page"><PageHeader kicker="RELEASE / LOG" title="版本日志" summary="应用能力与知识内容分别发布、分别记录。" />
    <section><h2>应用版本</h2><p>当前应用：{APP_VERSION}</p><ol>{state.data.appChangelog.entries.map((entry) => <li key={`${entry.version}-${entry.date}`}><StateGlyph state={entry.version === APP_VERSION ? 'current' : 'unread'} /><strong>{entry.version}{entry.version === APP_VERSION ? '（当前）' : ''}</strong><span>{entry.date}</span><p>{entry.summary}</p></li>)}</ol></section>
    <section><h2>知识版本</h2><p>当前运行知识：{state.data.contentVersion}</p><ol>{state.data.knowledgeChangelog.entries.map((entry) => <li key={`${entry.version}-${entry.date}`}><StateGlyph state={entry.version === state.data.contentVersion ? 'current' : 'unread'} /><strong>{entry.version}{entry.version === state.data.contentVersion ? '（当前）' : ''}</strong><span>{entry.date}</span><p>{entry.summary}</p></li>)}</ol></section>
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
  return <section className="atlas-page storage-page"><PageHeader kicker="LOCAL / STORAGE" title="存储与修复" summary="检查浏览器空间、知识缓存与个人记录；活动知识不会被个人数据操作清除。" />
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
  return <section className="atlas-page backup-page"><PageHeader kicker="LOCAL / BACKUP" title="备份与恢复" summary="备份只包含不可重新下载的个人状态，不包含正文、媒体、搜索索引、Cache Storage 或离线下载记录。" />
    <dl className="offline-overview"><div><dt>节点状态</dt><dd>{local.nodeStates.length}</dd></div><div><dt>问题链 / 草稿</dt><dd>{local.questionChains.length} / {local.questionDrafts.length}</dd></div><div><dt>待删除 / 意见</dt><dd>{local.pendingRemovals.length} / {local.opinions.length}</dd></div><div><dt>应用 / 知识版本</dt><dd>{APP_VERSION} / {knowledgeVersion}</dd></div></dl>
    <div className="offline-actions"><button type="button" disabled={exporting} onClick={() => void exportBackup()}>{exporting ? '正在准备备份…' : '导出个人备份'}</button><button type="button" onClick={() => void setBackupReminderEnabled(!(reminder?.enabled ?? true)).then(() => void refresh())}>{reminder?.enabled === false ? '启用备份提醒' : '关闭备份提醒'}</button></div>
    {message && <p role="status">{message}</p>}
    <section className="restore-panel"><h2>恢复个人备份</h2><p>恢复会整套替换当前个人状态；离线知识和下载记录不会变化。</p><label>选择 JSON 备份文件<input type="file" accept="application/json,.json" onChange={(event) => void selectRestoreFile(event.currentTarget.files?.[0])} /></label>{prepared && <><p>备份：应用 {prepared.backup.app_version} · 知识 {prepared.backup.knowledge_version}</p><p>当前将被清除 {prepared.summary.current_clear} 条，备份将导入 {prepared.summary.imported} 条，将跳过 {Object.values(prepared.summary.skipped).reduce((total, count) => total + count, 0)} 条；将保留 {prepared.summary.offline_metadata_retained} 条离线元数据。</p>{Object.entries(prepared.summary.skipped).map(([reason, count]) => <p key={reason}>{reason}：{count}</p>)}{prepared.summary.warnings.map((warning) => <p key={warning}>{warning}</p>)}<button type="button" disabled={!restoreReady && currentPersonalCount > 0} onClick={() => void restore()}>{restoreReady || currentPersonalCount === 0 ? '确认整套替换恢复' : '请先导出当前备份'}</button></>}</section>
  </section>
}
