import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { getAppVersionResponse, isGetAppVersionMessage, isSkipWaitingMessage } from './pwa/service-worker-messages'

interface ServiceWorkerRuntime {
  __WB_MANIFEST: Parameters<typeof precacheAndRoute>[0]
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  skipWaiting(): Promise<void>
}

const serviceWorker = self as unknown as ServiceWorkerRuntime
const scopePath = '/myriad-atlas/'

precacheAndRoute((self as unknown as ServiceWorkerRuntime).__WB_MANIFEST)
cleanupOutdatedCaches()

const navigationHandler = createHandlerBoundToURL('index.html')

registerRoute(
  ({ request, url }) => request.mode === 'navigate'
    && url.pathname.startsWith(scopePath)
    && !url.pathname.startsWith(`${scopePath}_generated/`)
    && !url.pathname.startsWith(`${scopePath}media/`),
  navigationHandler,
)

serviceWorker.addEventListener('message', (event) => {
  if (isGetAppVersionMessage(event.data)) event.ports[0]?.postMessage(getAppVersionResponse())
  if (isSkipWaitingMessage(event.data)) void serviceWorker.skipWaiting()
})
