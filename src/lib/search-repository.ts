import type { SearchStatus } from '../content/types'
import { basePath, PROJECT_BASE_PATH } from './base-path'
import { ContentClientError } from './errors'
import type { ContentRepository } from './content-client'
import { contentRepository } from './content-client'

export interface SearchResult {
  url: string
  excerpt: string
  meta: Record<string, string>
}
interface PagefindResultRef { data(): Promise<{ url?: unknown; meta?: unknown; excerpt?: unknown; raw_content?: unknown }> }
interface PagefindApi {
  init(options: { baseUrl: string; bundlePath: string }): Promise<void>
  preload(query: string, options?: { filters?: Record<string, string | string[]> }): Promise<void>
  search(query: string, options?: { filters?: Record<string, string | string[]> }): Promise<{ results: PagefindResultRef[] }>
  filters(): Promise<Record<string, Record<string, number>>>
}
type ImportPagefind = (url: string) => Promise<PagefindApi>

export class SearchRepository {
  private api?: PagefindApi
  private initialization?: Promise<PagefindApi>
  private generation = 0

  constructor(
    private readonly content: ContentRepository,
    private readonly importer: ImportPagefind = (url) => import(/* @vite-ignore */ url) as Promise<PagefindApi>,
  ) {}

  async init(): Promise<void> {
    if (this.api) return
    const generation = this.generation
    const initialization = this.initialization ??= this.importer(basePath('_generated/pagefind/pagefind.js')).then(async (api) => {
      await api.init({ baseUrl: PROJECT_BASE_PATH, bundlePath: basePath('_generated/pagefind/') })
      return api
    })
    try {
      const api = await initialization
      if (generation !== this.generation) return this.init()
      this.api = api
    } catch (error) {
      if (generation === this.generation) this.initialization = undefined
      throw new ContentClientError('missing', '全文搜索索引不可用。', { cause: error })
    }
  }
  dispose(): void {
    this.generation += 1
    this.api = undefined
    this.initialization = undefined
  }
  invalidate(): void {
    this.dispose()
  }
  reset(): void {
    this.dispose()
  }
  async reload(): Promise<void> {
    this.dispose()
    await this.init()
  }
  async status(signal?: AbortSignal): Promise<SearchStatus | { available: true }> {
    try {
      await this.init()
      return { available: true }
    } catch (error) {
      try {
        return await this.content.loadSearchStatus(signal)
      } catch {
        throw error
      }
    }
  }
  async preload(query: string, filters?: Record<string, string | string[]>): Promise<void> {
    await this.init()
    await this.api!.preload(query, { filters })
  }
  async search(query: string, filters?: Record<string, string | string[]>): Promise<SearchResult[]> {
    await this.init()
    const response = await this.api!.search(query, { filters })
    return Promise.all(response.results.map(async (reference) => {
      const data = await reference.data()
      const meta = isStringRecord(data.meta) ? data.meta : {}
      return {
        url: typeof data.url === 'string' ? data.url : '',
        excerpt: toSearchExcerpt(data.excerpt, data.raw_content),
        meta,
      }
    }))
  }
  async filters(): Promise<Record<string, Record<string, number>>> {
    await this.init()
    return this.api!.filters()
  }
}

const SEARCH_EXCERPT_LIMIT = 280

export function toSearchExcerpt(excerpt: unknown, rawContent?: unknown): string {
  const source = typeof excerpt === 'string' ? excerpt : typeof rawContent === 'string' ? rawContent : ''
  const plain = source
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(nbsp|#160);/gi, ' ')
    .replace(/&(amp|lt|gt|quot|#39);/gi, (_match, entity: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[entity.toLowerCase()] ?? ' '))
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > SEARCH_EXCERPT_LIMIT ? `${plain.slice(0, SEARCH_EXCERPT_LIMIT).trimEnd()}…` : plain
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).every((entry) => typeof entry === 'string')
}

export const searchRepository = new SearchRepository(contentRepository)
