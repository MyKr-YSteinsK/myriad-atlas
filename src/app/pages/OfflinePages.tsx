import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAppData } from '../data/app-data-context'
import { useLocalStateSnapshot } from '../state/use-local-state'
import { APP_VERSION } from '../../lib/content-version'
import { contentRepository } from '../../lib/content-client'
import { searchRepository } from '../../lib/search-repository'
import { isIphoneSafari, isStandalone } from '../../pwa/install-detection'
import { ContentDownloadManager } from '../../pwa/download/content-download'
import { ContentActivationManager } from '../../pwa/update/content-activation'
import { KnowledgeUpdateChecker, type KnowledgeUpdateCheck } from '../../pwa/update/knowledge-update-check'
import { verifyActiveContent, type ActiveContentVerification } from '../../pwa/update/content-integrity'
import { ContentRepairManager } from '../../pwa/update/content-repair'
import { cleanupTemporaryContentCaches } from '../../pwa/update/cache-cleanup'
import { listContentCaches, readActivePointer, type ContentCacheStorage } from '../../pwa/content-cache'
import { type ActiveContentPointer } from '../../pwa/cache-protocol'
import { localState } from '../state/local-state'
import { useAppUpdate } from '../../pwa/app-update-context'

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
  return ({ estimating: '正在估算空间', downloading: '正在下载', paused: '下载已暂停', failed: '下载失败', verifying: '正在验证', 'ready-to-activate': '已验证，等待激活', activating: '正在激活', active: '已完整离线' } as Record<string, string>)[status] ?? status
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
    if (!result.active) throw new Error(result.error || '知识更新失败，仍在使用旧版本。')
  })
  const currentMode = (() => {
    const standalone = typeof window !== 'undefined' && isStandalone(window.matchMedia?.('(display-mode: standalone)').matches ?? false, (navigator as Navigator & { standalone?: boolean }).standalone === true)
    return standalone ? '主屏幕 Web App' : isIphoneSafari(navigator.userAgent) ? 'iPhone Safari 标签页' : '浏览器标签页'
  })()
  return <section className="atlas-page offline-page"><p className="atlas-coordinate">LOCAL / OFFLINE</p><h1 tabIndex={-1}>离线与更新</h1>
    <dl className="offline-overview"><div><dt>运行模式</dt><dd>{currentMode}</dd></div><div><dt>应用外壳</dt><dd>{({ unsupported: '不支持或开发模式', registering: '注册中', ready: '已就绪', 'offline-ready': '离线外壳已就绪', 'update-available': '应用更新可用', activating: '正在更新', error: '注册失败' } as Record<string, string>)[appUpdate.state.status]}</dd></div><div><dt>离线知识</dt><dd>{pointer ? `已激活 ${pointer.content_version}` : '尚未完整下载'}</dd></div></dl>
    {!runtime && <p role="status">此浏览器不支持 Cache Storage，无法提供完整离线知识。</p>}
    {job && <section className="offline-card"><h2>{jobLabel(job.status)}</h2><p>{job.content_version} · {job.files_done} / {job.files_total} 个文件 · {displayBytes(job.bytes_done)} / {displayBytes(job.bytes_total)}</p>{job.error_message && <details><summary>查看错误详情</summary><p>{job.error_message}</p></details>}</section>}
    {verification && <p role="status">完整性检查：{verification.status}。{verification.message}</p>}
    {check && <p role="status">知识检查：{check.message}</p>}
    {error && <p role="alert">{error}</p>}
    <div className="offline-actions">
      {!pointer && !job && <button type="button" disabled={!runtime || Boolean(busy)} onClick={() => void run('download', async () => { await runtime!.download.start() })}>开始完整下载</button>}
      {job?.status === 'downloading' && <button type="button" disabled={!runtime || Boolean(busy)} onClick={() => void run('pause', () => runtime!.download.pause(job.job_id))}>暂停</button>}
      {(job?.status === 'paused' || job?.status === 'failed') && <button type="button" disabled={!runtime || Boolean(busy)} onClick={() => void run('resume', async () => { await runtime!.download.retry(job.job_id) })}>{job.status === 'paused' ? '继续' : '重试失败'}</button>}
      {job?.status === 'ready-to-activate' && <button type="button" disabled={!runtime || Boolean(busy)} onClick={() => void activate()}>激活已验证版本</button>}
      <button type="button" disabled={!runtime || Boolean(busy)} onClick={() => void run('check', async () => { setCheck(await runtime!.checker.check({ manual: true })) })}>检查知识更新</button>
      {pointer && check?.status === 'update-available' && <button type="button" disabled={!runtime || Boolean(busy)} onClick={() => void run('update', async () => { await runtime!.download.start({ reuseActiveFiles: true }) })}>下载更新</button>}
      {pointer && <button type="button" disabled={!runtime || Boolean(busy)} onClick={() => void run('redownload', async () => { await runtime!.download.start({ reuseActiveFiles: true, forceCandidate: true }) })}>重新下载知识库</button>}
      {pointer && <button type="button" disabled={!runtime || Boolean(busy)} onClick={() => void run('verify', async () => { setVerification(await verifyActiveContent(runtime!.storage, appData.state.status === 'ready' || appData.state.status === 'empty' ? appData.state.data.contentVersion : undefined)) })}>验证完整性</button>}
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
    <p className="offline-note">清理临时缓存不会清除 active 知识、Service Worker 或个人数据。</p>
  </section>
}

export function BackupPlaceholderPage() {
  return <section className="atlas-page"><p className="atlas-coordinate">LOCAL / BACKUP</p><h1 tabIndex={-1}>备份与恢复</h1><p>个人数据备份与恢复将在下一阶段启用；离线知识内容不会写入个人备份。</p><Link to="/me">返回我的</Link></section>
}
