import type { SearchStatus } from '../content/types'
import { basePath, PROJECT_BASE_PATH } from './base-path'
import { ContentClientError } from './errors'
import type { ContentRepository } from './content-client'

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

  constructor(
    private readonly content: ContentRepository,
    private readonly importer: ImportPagefind = (url) => import(/* @vite-ignore */ url) as Promise<PagefindApi>,
  ) {}

  async init(): Promise<void> {
    if (this.api) return
    this.initialization ??= this.importer(basePath('_generated/pagefind/pagefind.js')).then(async (api) => {
      await api.init({ baseUrl: PROJECT_BASE_PATH, bundlePath: basePath('_generated/pagefind/') })
      this.api = api
      return api
    }).catch((error: unknown) => {
      this.initialization = undefined
      throw new ContentClientError('missing', '全文搜索索引不可用。', { cause: error })
    })
    await this.initialization
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
        excerpt: typeof data.raw_content === 'string' ? data.raw_content : typeof data.excerpt === 'string' ? data.excerpt : '',
        meta,
      }
    }))
  }
  async filters(): Promise<Record<string, Record<string, number>>> {
    await this.init()
    return this.api!.filters()
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).every((entry) => typeof entry === 'string')
}
