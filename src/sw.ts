import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { getAppVersionResponse, isGetAppVersionMessage } from './pwa/service-worker-messages'
import { CONTENT_CACHE_MESSAGES } from './pwa/cache-protocol'
import { VersionedContentHandler } from './pwa/worker-content-handler'
import { registerServiceWorkerLifecycle, type ServiceWorkerLifecycleRuntime } from './pwa/service-worker-lifecycle'

interface ServiceWorkerRuntime extends ServiceWorkerLifecycleRuntime {
  __WB_MANIFEST: Parameters<typeof precacheAndRoute>[0]
}

const serviceWorker = self as unknown as ServiceWorkerRuntime
const scopePath = '/myriad-atlas/'
const contentHandler = new VersionedContentHandler(self.location.origin, caches, (request) => fetch(request))

precacheAndRoute((self as unknown as ServiceWorkerRuntime).__WB_MANIFEST)
cleanupOutdatedCaches()

registerRoute(
  ({ request, url }) => request.mode === 'navigate'
    && url.pathname.startsWith(scopePath)
    && !url.pathname.startsWith(`${scopePath}_generated/`)
    && !url.pathname.startsWith(`${scopePath}media/`),
  async ({ request }) => {
    const cached = await matchPrecache('index.html') ?? await matchPrecache(`${scopePath}index.html`)
    if (cached) return cached
    try {
      return await fetch(request)
    } catch {
      return new Response('Application shell is unavailable.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain;charset=utf-8', 'X-Myriad-Offline': 'app-shell-missing' },
      })
    }
  },
)

registerRoute(
  ({ url }) => contentHandler.matches(url),
  ({ request }) => contentHandler.handle(request),
)

registerServiceWorkerLifecycle(serviceWorker, (event) => {
  if (isGetAppVersionMessage(event.data)) event.ports[0]?.postMessage(getAppVersionResponse())
  if (typeof event.data === 'object' && event.data !== null && 'type' in event.data
    && (event.data.type === CONTENT_CACHE_MESSAGES.activated || event.data.type === CONTENT_CACHE_MESSAGES.rolledBack)) contentHandler.resetPointer()
})
