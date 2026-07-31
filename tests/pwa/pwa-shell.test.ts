import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getAppVersionResponse, isGetAppVersionMessage, isSkipWaitingMessage, SERVICE_WORKER_MESSAGES } from '../../src/pwa/service-worker-messages'

const root = resolve(import.meta.dirname, '../..')

async function pngDimensions(path: string): Promise<{ width: number; height: number }> {
  const bytes = await readFile(path)
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

describe('PWA shell', () => {
  it('uses the fixed GitHub Pages install scope and complete icons', async () => {
    const manifest = JSON.parse(await readFile(resolve(root, 'public/manifest.webmanifest'), 'utf8')) as {
      name: string
      short_name: string
      id: string
      start_url: string
      scope: string
      display: string
      lang: string
      icons: Array<{ src: string; sizes: string; purpose: string }>
    }
    expect(manifest).toMatchObject({
      name: '万象回廊 · MyKr',
      short_name: '万象回廊',
      id: '/myriad-atlas/',
      start_url: '/myriad-atlas/#/',
      scope: '/myriad-atlas/',
      display: 'standalone',
      lang: 'zh-CN',
    })
    expect(manifest.icons).toHaveLength(2)
    expect(manifest.icons.every((icon) => icon.purpose.includes('any') && icon.purpose.includes('maskable'))).toBe(true)
    await expect(pngDimensions(resolve(root, 'public/icons/icon-192.png'))).resolves.toEqual({ width: 192, height: 192 })
    await expect(pngDimensions(resolve(root, 'public/icons/icon-512.png'))).resolves.toEqual({ width: 512, height: 512 })
    await expect(pngDimensions(resolve(root, 'public/icons/apple-touch-icon-180.png'))).resolves.toEqual({ width: 180, height: 180 })
  })

  it('limits activation to explicit Service Worker messages', () => {
    expect(isGetAppVersionMessage({ type: SERVICE_WORKER_MESSAGES.getAppVersion })).toBe(true)
    expect(isSkipWaitingMessage({ type: SERVICE_WORKER_MESSAGES.skipWaiting })).toBe(true)
    expect(isSkipWaitingMessage({ type: 'anything-else' })).toBe(false)
    expect(isSkipWaitingMessage(null)).toBe(false)
    expect(getAppVersionResponse()).toEqual({ appVersion: '0.2.0' })
  })

  it('keeps runtime knowledge data outside the application precache source', async () => {
    const worker = await readFile(resolve(root, 'src/sw.ts'), 'utf8')
    expect(worker).toContain("const scopePath = '/myriad-atlas/'")
    expect(worker).toContain('precacheAndRoute((self as unknown as ServiceWorkerRuntime).__WB_MANIFEST)')
    expect(worker).toContain('cleanupOutdatedCaches()')
    expect(worker).toContain("await matchPrecache('index.html')")
    expect(worker).not.toContain('createHandlerBoundToURL')
    expect(worker).toContain('registerServiceWorkerLifecycle(serviceWorker')
    expect(worker).not.toContain('clientsClaim')
  })
})
