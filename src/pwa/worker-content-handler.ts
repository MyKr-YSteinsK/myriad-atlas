import { ACTIVE_POINTER_URL, CONTENT_META_CACHE, canonicalContentPath, hasNetworkBypass, isKnowledgeOwnedRuntimePath, normalizeActiveContentPointer, type ActiveContentPointer } from './cache-protocol'

interface WorkerCacheStorage {
  keys(): Promise<string[]>
  open(name: string): Promise<Pick<Cache, 'match'>>
}

export class VersionedContentHandler {
  private pointerState: { kind: 'unknown' } | { kind: 'none' } | { kind: 'invalid' } | { kind: 'active'; pointer: ActiveContentPointer } = { kind: 'unknown' }

  constructor(
    private readonly origin: string,
    private readonly cacheStorage: WorkerCacheStorage,
    private readonly fetcher: (request: Request) => Promise<Response>,
  ) {}

  matches(url: URL): boolean {
    return isKnowledgeOwnedRuntimePath(url, this.origin)
  }

  resetPointer(): void {
    this.pointerState = { kind: 'unknown' }
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = canonicalContentPath(url, this.origin)
    if (!path || !isKnowledgeOwnedRuntimePath(url, this.origin)) return this.fetcher(request)
    if (hasNetworkBypass(url)) {
      try { return await this.fetcher(request) } catch { return this.failure(504, 'network-bypass-failed') }
    }
    const state = await this.activePointer()
    if (state.kind === 'none') {
      try { return await this.fetcher(request) } catch { return this.failure(504, 'no-active-content') }
    }
    if (state.kind === 'invalid') return this.failure(503, 'invalid-active-pointer')
    if (state.kind !== 'active') return this.failure(503, 'active-pointer-unavailable')
    const response = await (await this.cacheStorage.open(state.pointer.cache_name)).match(path)
    return response ?? this.failure(503, 'active-cache-miss')
  }

  private async activePointer(): Promise<typeof this.pointerState> {
    if (this.pointerState.kind !== 'unknown') return this.pointerState
    try {
      const response = await (await this.cacheStorage.open(CONTENT_META_CACHE)).match(ACTIVE_POINTER_URL)
      if (!response) return this.pointerState = { kind: 'none' }
      const value: unknown = await response.json()
      const pointer = normalizeActiveContentPointer(value)
      if (!pointer || !(await this.cacheStorage.keys()).includes(pointer.cache_name)) return this.pointerState = { kind: 'invalid' }
      return this.pointerState = { kind: 'active', pointer }
    } catch {
      return this.pointerState = { kind: 'none' }
    }
  }

  private failure(status: 503 | 504, diagnostic: string): Response {
    return new Response('Offline content is unavailable.', { status, headers: { 'X-Myriad-Offline': diagnostic } })
  }
}
