import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkboxLifecycleEvent, WorkboxLifecycleWaitingEvent } from 'workbox-window'
import { AppUpdateController, canRegisterServiceWorker, type WorkboxLike } from '../../src/pwa/app-updates'
import { InstallGuidance } from '../../src/pwa/InstallGuidance'
import { isIphoneSafari, isStandalone } from '../../src/pwa/install-detection'

class FakeWorkbox implements WorkboxLike {
  readonly waitingListeners: Array<(event: WorkboxLifecycleWaitingEvent) => void> = []
  readonly controllingListeners: Array<(event: WorkboxLifecycleEvent) => void> = []
  readonly activatedListeners: Array<(event: WorkboxLifecycleEvent) => void> = []
  readonly messageSkipWaiting = vi.fn()
  registration: ServiceWorkerRegistration | undefined

  addEventListener(type: 'waiting' | 'controlling' | 'activated', listener: ((event: WorkboxLifecycleWaitingEvent) => void) | ((event: WorkboxLifecycleEvent) => void)): void {
    if (type === 'waiting') this.waitingListeners.push(listener as (event: WorkboxLifecycleWaitingEvent) => void)
    if (type === 'controlling') this.controllingListeners.push(listener as (event: WorkboxLifecycleEvent) => void)
    if (type === 'activated') this.activatedListeners.push(listener as (event: WorkboxLifecycleEvent) => void)
  }

  async register(): Promise<ServiceWorkerRegistration | undefined> { return this.registration }
  waiting(event: WorkboxLifecycleWaitingEvent): void { this.waitingListeners.forEach((listener) => listener(event)) }
  controlling(): void { this.controllingListeners.forEach((listener) => listener({ type: 'controlling' })) }
}

const productionEnvironment = { production: true, serviceWorkerSupported: true, protocol: 'https:', hostname: 'mykr.dev' }

describe('application updates', () => {
  it('registers only in production secure contexts', () => {
    expect(canRegisterServiceWorker(productionEnvironment)).toBe(true)
    expect(canRegisterServiceWorker({ ...productionEnvironment, production: false })).toBe(false)
    expect(canRegisterServiceWorker({ ...productionEnvironment, serviceWorkerSupported: false })).toBe(false)
    expect(canRegisterServiceWorker({ ...productionEnvironment, protocol: 'http:', hostname: 'example.test' })).toBe(false)
    expect(canRegisterServiceWorker({ ...productionEnvironment, protocol: 'http:', hostname: 'localhost' })).toBe(true)
  })

  it('waits for explicit confirmation, flushes state, and reloads once after control', async () => {
    const workbox = new FakeWorkbox()
    const reload = vi.fn()
    const controller = new AppUpdateController({
      environment: productionEnvironment,
      createWorkbox: (url, options) => {
        expect(url).toBe('/myriad-atlas/sw.js')
        expect(options).toEqual({ scope: '/myriad-atlas/' })
        return workbox
      },
      getTargetVersion: async () => '0.1.1',
      reload,
    })
    const flush = vi.fn(async () => undefined)
    controller.registerFlush(flush)
    controller.start()
    await Promise.resolve()
    workbox.waiting({ type: 'waiting', sw: {} as ServiceWorker })
    await waitFor(() => expect(controller.getState()).toMatchObject({ status: 'update-available', targetVersion: '0.1.1' }))
    const pending = controller.activateUpdate()
    expect(flush).toHaveBeenCalledOnce()
    await waitFor(() => expect(workbox.messageSkipWaiting).toHaveBeenCalledOnce())
    workbox.controlling()
    await expect(pending).resolves.toBe(true)
    workbox.controlling()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does not activate or reload when a local flush fails', async () => {
    const workbox = new FakeWorkbox()
    const reload = vi.fn()
    const controller = new AppUpdateController({ environment: productionEnvironment, createWorkbox: () => workbox, reload, getTargetVersion: async () => undefined })
    controller.registerFlush(async () => { throw new Error('storage failed') })
    controller.start()
    await Promise.resolve()
    workbox.waiting({ type: 'waiting', sw: {} as ServiceWorker })
    await Promise.resolve()

    await expect(controller.activateUpdate()).resolves.toBe(false)
    expect(workbox.messageSkipWaiting).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    expect(controller.getState()).toMatchObject({ status: 'update-available', error: '本地输入尚未保存，未重新加载应用。' })
  })

  it('keeps the waiting worker visible when control does not arrive before the timeout', async () => {
    const workbox = new FakeWorkbox()
    const reload = vi.fn()
    const controller = new AppUpdateController({ environment: productionEnvironment, createWorkbox: () => workbox, reload, getTargetVersion: async () => undefined, controlTimeoutMs: 1 })
    controller.start()
    await Promise.resolve()
    workbox.waiting({ type: 'waiting', sw: {} as ServiceWorker })
    await Promise.resolve()

    await expect(controller.activateUpdate()).resolves.toBe(false)
    expect(workbox.messageSkipWaiting).toHaveBeenCalledOnce()
    expect(reload).not.toHaveBeenCalled()
    expect(controller.getState()).toMatchObject({ status: 'update-available', lifecycle: 'failed' })
  })

  it('keeps externally discovered waiting workers observable', async () => {
    const workbox = new FakeWorkbox()
    const controller = new AppUpdateController({ environment: productionEnvironment, createWorkbox: () => workbox, getTargetVersion: async () => undefined })
    controller.start()
    await Promise.resolve()
    workbox.waiting({ type: 'waiting', sw: {} as ServiceWorker, isExternal: true })
    await Promise.resolve()
    expect(controller.getState()).toMatchObject({ status: 'update-available', isExternal: true })
  })
})

describe('installation guidance', () => {
  beforeEach(() => {
    localStorage.clear()
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0' })
  })

  it('identifies standalone and iPhone Safari without offering a fake install action', () => {
    expect(isStandalone(true, false)).toBe(true)
    expect(isStandalone(false, true)).toBe(true)
    expect(isIphoneSafari('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile/15E148 Safari/604.1')).toBe(true)
    expect(isIphoneSafari('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) CriOS/120.0 Mobile/15E148 Safari/604.1')).toBe(false)
    const { container } = render(<InstallGuidance />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows iPhone Safari steps but no steps in standalone mode', () => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile/15E148 Safari/604.1' })
    const view = render(<InstallGuidance />)
    expect(screen.getByRole('heading', { name: '添加到 iPhone 主屏幕' })).toBeInTheDocument()
    view.unmount()
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    render(<InstallGuidance />)
    expect(screen.getByText(/当前正作为主屏幕 Web App 运行/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '添加到 iPhone 主屏幕' })).not.toBeInTheDocument()
  })

  it('uses a real browser install event when one is available', () => {
    const prompt = vi.fn(async () => undefined)
    const { container } = render(<InstallGuidance />)
    const event = Object.assign(new Event('beforeinstallprompt'), { prompt })
    fireEvent(window, event)
    expect(screen.getByRole('button', { name: '安装应用' })).toBeInTheDocument()
    expect(container.querySelector('button')?.textContent).toBe('安装应用')
  })
})
