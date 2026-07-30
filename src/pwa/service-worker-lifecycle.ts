import { isSkipWaitingMessage } from './service-worker-messages'

export interface WorkerMessageEvent {
  data: unknown
  ports: MessagePort[]
}

export interface WorkerActivateEvent {
  waitUntil(promise: Promise<unknown>): void
}

export interface ServiceWorkerLifecycleRuntime {
  addEventListener(type: 'message', listener: (event: WorkerMessageEvent) => void): void
  addEventListener(type: 'activate', listener: (event: WorkerActivateEvent) => void): void
  skipWaiting(): Promise<void>
  clients: { claim(): Promise<void> }
}

/** Registers the only explicit takeover path: a user-confirmed message. */
export function registerServiceWorkerLifecycle(
  runtime: ServiceWorkerLifecycleRuntime,
  onMessage: (event: WorkerMessageEvent) => void,
): void {
  runtime.addEventListener('message', (event) => {
    if (isSkipWaitingMessage(event.data)) void runtime.skipWaiting()
    onMessage(event)
  })
  runtime.addEventListener('activate', (event) => event.waitUntil(runtime.clients.claim()))
}
