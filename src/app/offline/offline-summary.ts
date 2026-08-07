import type { AppUpdateState } from '../../pwa/app-updates'
import type { KnowledgeUpdateCheck } from '../../pwa/update/knowledge-update-check'

export function updateSummary(check: KnowledgeUpdateCheck | undefined): string {
  if (!check) return '尚未检查'
  if (check.status === 'up-to-date') return '已是最新知识'
  if (check.status === 'update-available') return '发现新知识版本'
  if (check.status === 'cooldown') return '近期已检查'
  if (check.status === 'first-download-available') return '可下载完整知识库'
  if (check.status === 'fingerprint-conflict') return '检测到发布版本异常'
  return '暂时无法确认更新'
}

export function shellSummary(status: AppUpdateState): string {
  if (status.status === 'error') return '离线外壳注册失败'
  if (status.status === 'offline-ready' || status.status === 'ready' || status.status === 'update-available') return '可离线使用'
  if (status.status === 'unsupported') return '不支持或开发模式'
  return '正在准备离线外壳'
}
