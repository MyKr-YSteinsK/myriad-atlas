import { describe, expect, it, vi } from 'vitest'
import type { WorkboxLifecycleEvent, WorkboxLifecycleWaitingEvent } from 'workbox-window'
import { AppUpdateController, type WorkboxLike } from '../../src/pwa/app-updates'
import { SERVICE_WORKER_MESSAGES } from '../../src/pwa/service-worker-messages'
import { registerServiceWorkerLifecycle, type ServiceWorkerLifecycleRuntime, type WorkerActivateEvent, type WorkerMessageEvent } from '../../src/pwa/service-worker-lifecycle'

class ControlledWorker implements ServiceWorkerLifecycleRuntime {
  private readonly messages: Array<(event: WorkerMessageEvent) => void> = []
  private readonly activations: Array<(event: WorkerActivateEvent) => void> = []
  readonly skipWaiting = vi.fn(async () => undefined)
  readonly clients = { claim: vi.fn(async () => undefined) }

  addEventListener(type: 'message', listener: (event: WorkerMessageEvent) => void): void
  addEventListener(type: 'activate', listener: (event: WorkerActivateEvent) => void): void
  addEventListener(type: 'message' | 'activate', listener: ((event: WorkerMessageEvent) => void) | ((event: WorkerActivateEvent) => void)): void {
    if (type === 'message') this.messages.push(listener as (event: WorkerMessageEvent) => void)
    else this.activations.push(listener as (event: WorkerActivateEvent) => void)
  }

  message(data: unknown): void {
    this.messages.forEach((listener) => listener({ data, ports: [] }))
  }

  async activate(): Promise<void> {
    const work: Promise<unknown>[] = []
    this.activations.forEach((listener) => listener({ waitUntil: (promise) => work.push(promise) }))
    await Promise.all(work)
  }
}

class LifecycleWorkbox implements WorkboxLike {
  private readonly waitingListeners: Array<(event: WorkboxLifecycleWaitingEvent) => void> = []
  private readonly controllingListeners: Array<(event: WorkboxLifecycleEvent) => void> = []
  private readonly activatedListeners: Array<(event: WorkboxLifecycleEvent) => void> = []
  private readonly worker: ControlledWorker

  constructor(worker: ControlledWorker) {
    this.worker = worker
  }

  addEventListener(type: 'waiting' | 'controlling' | 'activated', listener: ((event: WorkboxLifecycleWaitingEvent) => void) | ((event: WorkboxLifecycleEvent) => void)): void {
    if (type === 'waiting') this.waitingListeners.push(listener as (event: WorkboxLifecycleWaitingEvent) => void)
    if (type === 'controlling') this.controllingListeners.push(listener as (event: WorkboxLifecycleEvent) => void)
    if (type === 'activated') this.activatedListeners.push(listener as (event: WorkboxLifecycleEvent) => void)
  }

  async register(): Promise<ServiceWorkerRegistration | undefined> { return undefined }
  messageSkipWaiting(): void {
    this.worker.message({ type: SERVICE_WORKER_MESSAGES.skipWaiting })
    void this.worker.activate().then(() => this.controllingListeners.forEach((listener) => listener({ type: 'controlling' })))
  }
  waiting(): void { this.waitingListeners.forEach((listener) => listener({ type: 'waiting', sw: {} as ServiceWorker })) }
}

describe('service worker takeover lifecycle', () => {
  it('does not skip at registration and claims clients when an explicit skip message activates the worker', async () => {
    const worker = new ControlledWorker()
    const received = vi.fn()
    registerServiceWorkerLifecycle(worker, received)

    expect(worker.skipWaiting).not.toHaveBeenCalled()
    worker.message({ type: 'OTHER' })
    expect(worker.skipWaiting).not.toHaveBeenCalled()

    worker.message({ type: SERVICE_WORKER_MESSAGES.skipWaiting })
    await vi.waitFor(() => expect(worker.skipWaiting).toHaveBeenCalledOnce())
    await worker.activate()

    expect(worker.clients.claim).toHaveBeenCalledOnce()
    expect(received).toHaveBeenCalledTimes(2)
  })

  it('reloads once only after the worker command activates, claims clients, and controls the page', async () => {
    const worker = new ControlledWorker()
    registerServiceWorkerLifecycle(worker, () => undefined)
    const workbox = new LifecycleWorkbox(worker)
    const reload = vi.fn()
    const controller = new AppUpdateController({
      environment: { production: true, serviceWorkerSupported: true, protocol: 'https:', hostname: 'example.test' },
      createWorkbox: () => workbox,
      getTargetVersion: async () => '0.2.1',
      reload,
    })
    const flush = vi.fn(async () => undefined)
    controller.registerFlush(flush)
    controller.start()
    await Promise.resolve()
    workbox.waiting()
    await vi.waitFor(() => expect(controller.getState().status).toBe('update-available'))

    await expect(controller.activateUpdate()).resolves.toBe(true)
    expect(flush).toHaveBeenCalledOnce()
    expect(worker.skipWaiting).toHaveBeenCalledOnce()
    expect(worker.clients.claim).toHaveBeenCalledOnce()
    expect(reload).toHaveBeenCalledOnce()
    expect(controller.getState().lifecycle).toBe('reload-pending')
  })
})
