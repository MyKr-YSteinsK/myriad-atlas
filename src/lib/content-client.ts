import type {
  CatalogRecord,
  RuntimeCatalog,
  RuntimeAppChangelog,
  RuntimeContentManifest,
  RuntimeKnowledgeChangelog,
  RuntimeKnowledgeMap,
  RuntimeNode,
  RuntimeQaIndex,
  RuntimeRoute,
  RuntimeRoutesIndex,
  RuntimeTaxonomy,
  SearchStatus,
} from '../content/types'
import { basePath, PROJECT_BASE_PATH } from './base-path'
import { APP_VERSION } from './content-version'
import { ContentClientError } from './errors'

const SUPPORTED_SCHEMA_VERSION = 1
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
function hasEnvelope(value: unknown): value is Record<string, unknown> & { schema_version: number; content_version: string } {
  return isRecord(value) && typeof value.schema_version === 'number' && typeof value.content_version === 'string'
}
function safeId(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
}
function safeManifestPath(value: unknown): value is string {
  return typeof value === 'string' && /^(?:_generated|media)\/[a-zA-Z0-9._/-]+$/.test(value)
    && !value.includes('..') && !value.includes('//')
}
function validAppLog(value: Record<string, unknown>): boolean {
  return typeof value.current_version === 'string' && Array.isArray(value.entries)
    && value.entries.every((entry) => isRecord(entry) && typeof entry.version === 'string'
      && /^\d{4}-\d{2}-\d{2}$/.test(String(entry.date)) && typeof entry.summary === 'string')
}
function validKnowledgeLog(value: Record<string, unknown>): boolean {
  return typeof value.current_version === 'string' && Array.isArray(value.entries)
    && value.entries.every((entry) => isRecord(entry) && typeof entry.version === 'string'
      && /^\d{4}-\d{2}-\d{2}$/.test(String(entry.date)) && typeof entry.summary === 'string'
      && ['categories', 'added_nodes', 'modified_nodes', 'deleted_nodes'].every((key) => Array.isArray(entry[key]) && entry[key].every((item) => typeof item === 'string')))
}

export class ContentRepository {
  private readonly cache = new Map<string, unknown>()
  private expectedContentVersion?: string
  private generation = 0

  constructor(private readonly fetcher: FetchLike = globalThis.fetch.bind(globalThis)) {}

  private async fetchJson(path: string, signal?: AbortSignal): Promise<unknown> {
    let response: Response
    try {
      response = await this.fetcher(basePath(path), { signal })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      throw new ContentClientError('network', '无法连接内容文件，请检查网络或稍后重试。')
    }
    const offlineDiagnostic = response.headers.get('X-Myriad-Offline')
    if (offlineDiagnostic) {
      const damaged = offlineDiagnostic === 'active-cache-miss' || offlineDiagnostic === 'invalid-active-pointer'
      throw new ContentClientError('offline', damaged ? '离线内容已损坏，请检查完整性或重新下载。' : '离线内容当前不可用。')
    }
    if (response.status === 404) throw new ContentClientError('missing', '构建内容文件不存在。请重新执行内容构建。')
    if (!response.ok) throw new ContentClientError('network', `内容请求失败（HTTP ${response.status}）。`)
    try {
      return await response.json()
    } catch {
      throw new ContentClientError('malformed', '内容文件不是有效 JSON，可能已损坏。')
    }
  }

  private acceptEnvelope(value: unknown, label: string): asserts value is Record<string, unknown> & { schema_version: 1; content_version: string } {
    if (!hasEnvelope(value)) throw new ContentClientError('malformed', `${label}结构无效。`)
    if (value.schema_version !== SUPPORTED_SCHEMA_VERSION) throw new ContentClientError('unsupported-version', `${label}版本不受当前应用支持。`)
    if (this.expectedContentVersion && value.content_version !== this.expectedContentVersion) {
      throw new ContentClientError('application', '内容产物版本不一致，请重新构建或刷新。')
    }
    this.expectedContentVersion ??= value.content_version
  }

  private async load<T>(path: string, label: string, check: (value: Record<string, unknown>) => boolean, signal?: AbortSignal): Promise<T> {
    const cached = this.cache.get(path)
    if (cached) return cached as T
    const generation = this.generation
    const value = await this.fetchJson(path, signal)
    if (generation !== this.generation) return this.load(path, label, check, signal)
    this.acceptEnvelope(value, label)
    if (!check(value)) throw new ContentClientError('malformed', `${label}缺少必要字段。`)
    this.cache.set(path, value)
    return value as T
  }
  private async loadIndependent<T>(path: string, label: string, check: (value: Record<string, unknown>) => boolean, signal?: AbortSignal): Promise<T> {
    const cached = this.cache.get(path)
    if (cached) return cached as T
    const value = await this.fetchJson(path, signal)
    if (!isRecord(value) || value.schema_version !== SUPPORTED_SCHEMA_VERSION || !check(value)) {
      throw new ContentClientError('malformed', `${label}结构无效。`)
    }
    this.cache.set(path, value)
    return value as T
  }
  invalidate(): void {
    this.generation += 1
    this.cache.clear()
    this.expectedContentVersion = undefined
  }
  async reload(signal?: AbortSignal): Promise<{
    catalog: RuntimeCatalog
    taxonomy: RuntimeTaxonomy
    routes: RuntimeRoutesIndex
    qaIndex: RuntimeQaIndex
    manifest: RuntimeContentManifest
    appChangelog: RuntimeAppChangelog
    knowledgeChangelog: RuntimeKnowledgeChangelog
  }> {
    this.invalidate()
    const [catalog, taxonomy, routes, qaIndex, manifest, appChangelog, knowledgeChangelog] = await Promise.all([
      this.loadCatalog(signal),
      this.loadTaxonomy(signal),
      this.loadRoutesIndex(signal),
      this.loadQaIndex(signal),
      this.loadContentManifest(signal),
      this.loadAppChangelog(signal),
      this.loadKnowledgeChangelog(signal),
    ])
    if (manifest.content_version !== catalog.content_version || knowledgeChangelog.current_version !== catalog.content_version || appChangelog.current_version !== APP_VERSION) {
      throw new ContentClientError('application', '运行时版本元数据不一致。')
    }
    return { catalog, taxonomy, routes, qaIndex, manifest, appChangelog, knowledgeChangelog }
  }

  loadCatalog(signal?: AbortSignal): Promise<RuntimeCatalog> {
    return this.load('_generated/catalog.json', '目录文件', (value) => Array.isArray(value.nodes)
      && value.nodes.every((node) => isRecord(node) && typeof node.id === 'string'
        && node.node_path === `_generated/nodes/${node.id}.json`), signal)
  }
  loadTaxonomy(signal?: AbortSignal): Promise<RuntimeTaxonomy> {
    return this.load('_generated/taxonomy.json', '分类文件', (value) => Array.isArray(value.domains), signal)
  }
  loadRoutesIndex(signal?: AbortSignal): Promise<RuntimeRoutesIndex> {
    return this.load('_generated/routes.json', '路线索引', (value) => Array.isArray(value.routes)
      && value.routes.every((route) => isRecord(route) && typeof route.id === 'string'
        && route.route_path === `_generated/routes/${route.id}.json`), signal)
  }
  async loadQaIndex(signal?: AbortSignal): Promise<RuntimeQaIndex> {
    const [index, catalog] = await Promise.all([
      this.load<RuntimeQaIndex>('_generated/qa-index.json', '问题链索引', (value) => Array.isArray(value.chains), signal),
      this.loadCatalog(signal),
    ])
    const nodeIds = new Set(catalog.nodes.map((node) => node.id))
    if (index.chains.some((chain) => !nodeIds.has(chain.root_node_id)
      || chain.answers.some((answer) => !nodeIds.has(answer.node_id)
        || answer.node_path !== `_generated/nodes/${answer.node_id}.json`))) {
      throw new ContentClientError('application', '问题链索引引用了目录中不存在的节点。')
    }
    return index
  }
  async loadSearchStatus(signal?: AbortSignal): Promise<SearchStatus> {
    const value = await this.fetchJson('_generated/search-status.json', signal)
    if (!isRecord(value) || value.schema_version !== 1 || value.available !== false || value.reason !== 'empty-corpus') {
      throw new ContentClientError('malformed', '搜索状态文件结构无效。')
    }
    return value as unknown as SearchStatus
  }
  loadContentManifest(signal?: AbortSignal): Promise<RuntimeContentManifest> {
    return this.load('_generated/content-manifest.json', '内容清单', (value) => value.base_path === PROJECT_BASE_PATH
      && Array.isArray(value.files) && new Set(value.files.map((file) => isRecord(file) ? file.path : '')).size === value.files.length
      && value.files.every((file) => isRecord(file) && safeManifestPath(file.path)
        && typeof file.kind === 'string' && typeof file.bytes === 'number' && Number.isSafeInteger(file.bytes) && file.bytes >= 0
        && typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/.test(file.sha256)), signal)
  }
  loadAppChangelog(signal?: AbortSignal): Promise<RuntimeAppChangelog> {
    return this.loadIndependent('_generated/app-changelog.json', '应用版本日志', validAppLog, signal)
  }
  async loadKnowledgeChangelog(signal?: AbortSignal): Promise<RuntimeKnowledgeChangelog> {
    const [log, catalog] = await Promise.all([
      this.loadIndependent<RuntimeKnowledgeChangelog>('_generated/knowledge-changelog.json', '知识版本日志', validKnowledgeLog, signal),
      this.loadCatalog(signal),
    ])
    if (log.current_version !== catalog.content_version) throw new ContentClientError('application', '知识版本日志与目录版本不一致。')
    return log
  }
  loadKnowledgeMap(signal?: AbortSignal): Promise<RuntimeKnowledgeMap> {
    return this.load('_generated/knowledge-map.json', '知识地图', (value) => Array.isArray(value.nodes) && Array.isArray(value.edges) && Array.isArray(value.domains), signal)
  }
  async loadNode(nodeId: string, signal?: AbortSignal): Promise<RuntimeNode> {
    if (!safeId(nodeId)) throw new ContentClientError('missing', '节点 ID 无效。')
    const catalog = await this.loadCatalog(signal)
    const record = catalog.nodes.find((entry) => entry.id === nodeId)
    if (!record) throw new ContentClientError('missing', '未找到该知识节点。')
    const expectedPath = `_generated/nodes/${nodeId}.json`
    if (record.node_path !== expectedPath) throw new ContentClientError('application', '目录中的节点路径不安全。')
    const node = await this.load<RuntimeNode>(record.node_path, '节点文件', (value) => value.id === nodeId && typeof value.body_html === 'string' && Array.isArray(value.toc), signal)
    return node
  }
  async loadRoute(routeId: string, signal?: AbortSignal): Promise<RuntimeRoute> {
    if (!safeId(routeId)) throw new ContentClientError('missing', '路线 ID 无效。')
    const index = await this.loadRoutesIndex(signal)
    const record = index.routes.find((entry) => entry.id === routeId)
    if (!record) throw new ContentClientError('missing', '未找到该路线。')
    const expectedPath = `_generated/routes/${routeId}.json`
    if (record.route_path !== expectedPath) throw new ContentClientError('application', '路线索引路径不安全。')
    const route = await this.load<RuntimeRoute>(record.route_path, '路线文件', (value) => value.id === routeId && Array.isArray(value.stages), signal)
    const catalog = await this.loadCatalog(signal)
    const nodeIds = new Set(catalog.nodes.map((node) => node.id))
    if (route.stages.some((stage) => stage.modules.some((module) => module.units.some((unit) => !nodeIds.has(unit.node_id))))) {
      throw new ContentClientError('application', '路线引用了目录中不存在的节点。')
    }
    return route
  }
  getCachedRecord(nodeId: string): CatalogRecord | undefined {
    return (this.cache.get('_generated/catalog.json') as RuntimeCatalog | undefined)?.nodes.find((entry) => entry.id === nodeId)
  }
  getCachedCatalog(): RuntimeCatalog | undefined {
    return this.cache.get('_generated/catalog.json') as RuntimeCatalog | undefined
  }
}

export class ContentClient extends ContentRepository {}
export const contentRepository = new ContentRepository()
export const contentClient = contentRepository
