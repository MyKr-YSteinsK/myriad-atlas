import { APP_VERSION } from '../lib/content-version'

export const SERVICE_WORKER_MESSAGES = {
  getAppVersion: 'GET_APP_VERSION',
  skipWaiting: 'SKIP_WAITING',
} as const

export function isSkipWaitingMessage(value: unknown): boolean {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === SERVICE_WORKER_MESSAGES.skipWaiting
}

export function isGetAppVersionMessage(value: unknown): boolean {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === SERVICE_WORKER_MESSAGES.getAppVersion
}

export function getAppVersionResponse(): { appVersion: string } {
  return { appVersion: APP_VERSION }
}
