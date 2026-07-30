import type { CatalogRecord, RuntimeCatalog, RuntimeNode } from '../content/types'
import { basePath } from './base-path'
import { ContentClientError } from './errors'

const SUPPORTED_SCHEMA_VERSION = 1

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isCatalog(value: unknown): value is RuntimeCatalog {
  return isRecord(value) && value.schema_version === SUPPORTED_SCHEMA_VERSION && Array.isArray(value.nodes)
}

function isNode(value: unknown): value is RuntimeNode {
  return isRecord(value) && value.schema_version === SUPPORTED_SCHEMA_VERSION && typeof value.id === 'string' && typeof value.body_html === 'string' && Array.isArray(value.toc)
}

async function fetchJson(path: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(basePath(path), { signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ContentClientError('network', '无法连接内容文件，请检查网络或稍后重试。')
  }
  if (response.status === 404) throw new ContentClientError('missing', '构建内容文件不存在。请重新执行内容构建。')
  if (!response.ok) throw new ContentClientError('network', `内容请求失败（HTTP ${response.status}）。`)
  try {
    return await response.json()
  } catch {
    throw new ContentClientError('malformed', '内容文件不是有效 JSON，可能已损坏。')
  }
}

export class ContentClient {
  private catalog?: RuntimeCatalog

  async loadCatalog(signal?: AbortSignal): Promise<RuntimeCatalog> {
    if (this.catalog) return this.catalog
    const value = await fetchJson('_generated/catalog.json', signal)
    if (!isRecord(value) || typeof value.schema_version !== 'number') throw new ContentClientError('malformed', '目录文件结构无效。')
    if (value.schema_version !== SUPPORTED_SCHEMA_VERSION) throw new ContentClientError('unsupported-version', '内容版本不受当前应用支持。')
    if (!isCatalog(value)) throw new ContentClientError('malformed', '目录文件缺少节点列表。')
    this.catalog = value
    return value
  }

  async loadNode(nodeId: string, signal?: AbortSignal): Promise<RuntimeNode> {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(nodeId)) throw new ContentClientError('missing', '节点 ID 无效。')
    const catalog = await this.loadCatalog(signal)
    const record = catalog.nodes.find((entry) => entry.id === nodeId)
    if (!record) throw new ContentClientError('missing', '未找到该知识节点。')
    const expectedPath = `_generated/nodes/${encodeURIComponent(nodeId)}.json`
    if (record.node_path !== expectedPath) throw new ContentClientError('application', '目录中的节点路径不安全。')
    const value = await fetchJson(record.node_path, signal)
    if (!isRecord(value) || typeof value.schema_version !== 'number') throw new ContentClientError('malformed', '节点文件结构无效。')
    if (value.schema_version !== SUPPORTED_SCHEMA_VERSION) throw new ContentClientError('unsupported-version', '节点内容版本不受当前应用支持。')
    if (!isNode(value) || value.id !== nodeId) throw new ContentClientError('malformed', '节点文件与目录不一致。')
    return value
  }

  getCachedRecord(nodeId: string): CatalogRecord | undefined {
    return this.catalog?.nodes.find((entry) => entry.id === nodeId)
  }
}

export const contentClient = new ContentClient()
