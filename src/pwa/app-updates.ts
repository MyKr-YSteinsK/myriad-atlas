import { Workbox, type WorkboxLifecycleEvent, type WorkboxLifecycleWaitingEvent } from 'workbox-window'
import { APP_VERSION } from '../lib/content-version'
import { basePath, PROJECT_BASE_PATH } from '../lib/base-path'

export type AppUpdateStatus = 'unsupported' | 'registering' | 'ready' | 'offline-ready' | 'update-available' | 'activating' | 'error'
export type AppUpdateLifecycle = 'idle' | 'waiting' | 'activating' | 'controlling' | 'reload-pending' | 'failed'

export interface AppUpdateState {
  status: AppUpdateStatus
  lifecycle: AppUpdateLifecycle
  appVersion: string
  targetVersion?: string
  isExternal?: boolean
  error?: string
  ignored?: boolean
}

export interface RegistrationEnvironment {
  production: boolean
  serviceWorkerSupported: boolean
  protocol: string
  hostname: string
}

export interface WorkboxLike {
  addEventListener(type: 'waiting', listener: (event: WorkboxLifecycleWaitingEvent) => void): void
  addEventListener(type: 'controlling', listener: (event: WorkboxLifecycleEvent) => void): void
  addEventListener(type: 'activated', listener: (event: WorkboxLifecycleEvent) => void): void
  register(): Promise<ServiceWorkerRegistration | undefined>
  messageSkipWaiting(): void
}

export interface AppUpdateControllerOptions {
  environment?: RegistrationEnvironment
  createWorkbox?: (scriptUrl: string, options: { scope: string }) => WorkboxLike
  onStateChange?: (state: AppUpdateState) => void
  getTargetVersion?: (worker: ServiceWorker) => Promise<string | undefined>
  reload?: () => void
  controlTimeoutMs?: number
}

const UPDATE_CONTROL_TIMEOUT_MS = 12_000

export function currentRegistrationEnvironment(): RegistrationEnvironment {
  return {
    production: import.meta.env.PROD,
    serviceWorkerSupported: 'serviceWorker' in navigator,
    protocol: window.location.protocol,
    hostname: window.location.hostname,
  }
}

export function canRegisterServiceWorker(environment: RegistrationEnvironment): boolean {
  return environment.production
    && environment.serviceWorkerSupported
    && (environment.protocol === 'https:' || environment.hostname === 'localhost' || environment.hostname === '127.0.0.1' || environment.hostname === '[::1]')
}

export function requestWorkerAppVersion(worker: ServiceWorker, timeoutMs = 1_500): Promise<string | undefined> {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const timeout = window.setTimeout(() => resolve(undefined), timeoutMs)
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      window.clearTimeout(timeout)
      const value = event.data
      resolve(typeof value === 'object' && value !== null && 'appVersion' in value && typeof value.appVersion === 'string' ? value.appVersion : undefined)
    }
    worker.postMessage({ type: 'GET_APP_VERSION' }, [channel.port2])
  })
}

export class AppUpdateController {
  private readonly environment: RegistrationEnvironment
  private readonly createWorkbox: (scriptUrl: string, options: { scope: string }) => WorkboxLike
  private readonly onStateChange: (state: AppUpdateState) => void
  private readonly getTargetVersion: (worker: ServiceWorker) => Promise<string | undefined>
  private readonly reload: () => void
  private readonly controlTimeoutMs: number
  private readonly flushers = new Set<() => Promise<void>>()
  private readonly initialState: AppUpdateState = { status: 'unsupported', lifecycle: 'idle', appVersion: APP_VERSION }
  private state = this.initialState
  private workbox: WorkboxLike | undefined
  private resolveControl: (() => void) | undefined
  private active = true
  private reloaded = false

  constructor(options: AppUpdateControllerOptions = {}) {
    this.environment = options.environment ?? currentRegistrationEnvironment()
    this.createWorkbox = options.createWorkbox ?? ((scriptUrl, registerOptions) => new Workbox(scriptUrl, registerOptions))
    this.onStateChange = options.onStateChange ?? (() => undefined)
    this.getTargetVersion = options.getTargetVersion ?? requestWorkerAppVersion
    this.reload = options.reload ?? (() => window.location.reload())
    this.controlTimeoutMs = options.controlTimeoutMs ?? UPDATE_CONTROL_TIMEOUT_MS
  }

  getState(): AppUpdateState { return this.state }

  registerFlush(flush: () => Promise<void>): () => void {
    this.flushers.add(flush)
    return () => this.flushers.delete(flush)
  }

  start(): void {
    if (!canRegisterServiceWorker(this.environment)) {
      this.setState({ status: 'unsupported', lifecycle: 'idle', appVersion: APP_VERSION })
      return
    }
    this.setState({ status: 'registering', lifecycle: 'idle', appVersion: APP_VERSION })
    const workbox = this.createWorkbox(basePath('sw.js'), { scope: PROJECT_BASE_PATH })
    this.workbox = workbox
    workbox.addEventListener('waiting', (event) => { void this.onWaiting(event) })
    workbox.addEventListener('activated', (event) => {
      if (!this.active || this.state.status === 'activating') return
      this.setState({ status: event.isUpdate ? 'ready' : 'offline-ready', lifecycle: 'idle', appVersion: APP_VERSION })
    })
    workbox.addEventListener('controlling', () => {
      if (!this.active) return
      if (this.state.status === 'activating') this.setState({ ...this.state, lifecycle: 'controlling' })
      this.resolveControl?.()
    })
    void workbox.register().then((registration) => {
      if (!this.active || this.state.status !== 'registering') return
      this.setState({ status: 'ready', lifecycle: 'idle', appVersion: APP_VERSION })
      if (registration?.waiting) void this.onWaiting({ type: 'waiting', sw: registration.waiting, wasWaitingBeforeRegister: true })
    }).catch(() => {
      if (this.active) this.setState({ status: 'error', lifecycle: 'failed', appVersion: APP_VERSION, error: '应用离线外壳注册失败；在线浏览仍可使用。' })
    })
  }

  ignoreUpdate(): void {
    if (this.state.status === 'update-available') this.setState({ ...this.state, ignored: true })
  }

  async activateUpdate(): Promise<boolean> {
    if (this.state.status !== 'update-available' || !this.workbox) return false
    this.setState({ ...this.state, status: 'activating', lifecycle: 'activating', ignored: false, error: undefined })
    try {
      for (const flush of this.flushers) await flush()
    } catch {
      this.setState({ ...this.state, status: 'update-available', lifecycle: 'failed', error: '本地输入尚未保存，未重新加载应用。' })
      return false
    }
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          this.resolveControl = undefined
          reject(new Error('timeout'))
        }, this.controlTimeoutMs)
        this.resolveControl = () => {
          window.clearTimeout(timeout)
          this.resolveControl = undefined
          resolve()
        }
        this.workbox?.messageSkipWaiting()
      })
      if (!this.reloaded) {
        this.reloaded = true
        this.setState({ ...this.state, lifecycle: 'reload-pending' })
        this.reload()
      }
      return true
    } catch {
      this.setState({ ...this.state, status: 'update-available', lifecycle: 'failed', error: '新版本未能接管当前页面；请稍后重试。' })
      return false
    }
  }

  dispose(): void {
    this.active = false
    this.resolveControl = undefined
    this.flushers.clear()
  }

  private async onWaiting(event: WorkboxLifecycleWaitingEvent): Promise<void> {
    if (!this.active || !event.sw) return
    this.setState({ status: 'update-available', lifecycle: 'waiting', appVersion: APP_VERSION, isExternal: event.isExternal, ignored: false })
    const targetVersion = await this.getTargetVersion(event.sw).catch(() => undefined)
    if (this.active && this.state.status === 'update-available' && targetVersion) this.setState({ ...this.state, targetVersion })
  }

  private setState(next: AppUpdateState): void {
    this.state = next
    if (this.active) this.onStateChange(next)
  }
}
