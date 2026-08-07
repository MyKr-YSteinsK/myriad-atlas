import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAppData } from '../data/app-data-context'
import { localState } from '../state/local-state'
import { useLocalStateSnapshot } from '../state/use-local-state'
import { getBackupReminderState, setBackupReminderEnabled, type BackupReminderState } from '../backup/personal-backup'
import type { KnowledgeUpdateCheck } from '../../pwa/update/knowledge-update-check'

export function OfflineHomeHint() {
  const local = useLocalStateSnapshot()
  const [check, setCheck] = useState<KnowledgeUpdateCheck>()
  useEffect(() => { void localState.getAppMeta<KnowledgeUpdateCheck>('offline.last-check').then(setCheck).catch(() => undefined) }, [local.offlineJobs])
  const job = [...local.offlineJobs].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).find((entry) => entry.status !== 'active') ?? [...local.offlineJobs].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]
  if (check?.status === 'update-available') return <aside className="home-offline-hint" role="status"><p>有新的知识版本可用。</p><Link to="/me/offline">查看离线与更新</Link></aside>
  if (job?.status === 'failed') return <aside className="home-offline-hint" role="status"><p>知识下载未完成：{job.error_message || '请重试。'}</p><Link to="/me/offline">继续处理</Link></aside>
  if (!local.offlineJobs.some((entry) => entry.status === 'active')) return <aside className="home-offline-hint"><p>尚未完整下载知识库；离线阅读需要由你主动开始。</p><Link to="/me/offline">设置离线知识</Link></aside>
  return null
}

export function BackupReminder() {
  const { state } = useAppData(); const local = useLocalStateSnapshot(); const [reminder, setReminder] = useState<BackupReminderState>(); const [later, setLater] = useState(false)
  const knowledgeVersion = state.status === 'ready' || state.status === 'empty' ? state.data.contentVersion : 'unknown'
  useEffect(() => { void getBackupReminderState(knowledgeVersion).then(setReminder).catch(() => undefined) }, [knowledgeVersion, local.nodeStates, local.questionChains, local.questionDrafts, local.opinions, local.pendingRemovals])
  if (!reminder?.due || later) return null
  return <aside className="home-offline-hint" role="status"><p>个人状态已有 {reminder.mutationCount} 次变更，建议导出一份本地备份。</p><Link to="/me/backups">前往备份</Link><button type="button" onClick={() => setLater(true)}>稍后</button><button type="button" onClick={() => void setBackupReminderEnabled(false).then(() => setReminder({ ...reminder, enabled: false, due: false }))}>关闭提醒</button></aside>
}
