import { createHash } from 'node:crypto'
import { rm, readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'vite'
import { getManifest, injectManifest } from 'workbox-build'

const repositoryRoot = resolve('.')
const distDirectory = resolve(repositoryRoot, 'dist')
const temporaryDirectory = resolve(distDirectory, '.sw-build')
const appChangelogUrl = '_generated/app-changelog.json'

async function findWorkerSource(directory: string): Promise<string> {
  const files = await readdir(directory)
  const source = files.find((file) => file.endsWith('.js'))
  if (!source) throw new Error('Service Worker bundle was not produced.')
  return resolve(directory, source)
}

async function main(): Promise<void> {
  await rm(temporaryDirectory, { recursive: true, force: true })
  try {
    await build({
      configFile: resolve(repositoryRoot, 'vite.config.ts'),
      publicDir: false,
      define: { 'process.env.NODE_ENV': JSON.stringify('production') },
      build: {
        outDir: temporaryDirectory,
        emptyOutDir: true,
        lib: {
          entry: resolve(repositoryRoot, 'src/sw.ts'),
          formats: ['iife'],
          name: 'MyriadAtlasServiceWorker',
          fileName: 'sw-source',
        },
        rollupOptions: { output: { entryFileNames: 'sw-source.js' } },
      },
    })
    const source = await findWorkerSource(temporaryDirectory)
    const appChangelog = await readFile(resolve(distDirectory, appChangelogUrl))
    const precacheOptions = {
      globDirectory: distDirectory,
      globPatterns: ['**/*.{html,js,css,png,svg,webmanifest,ico}'],
      globIgnores: ['sw.js', '.sw-build/**', '_generated/**', 'media/**', '**/*.map'],
      additionalManifestEntries: [{ url: appChangelogUrl, revision: createHash('sha256').update(appChangelog).digest('hex') }],
    }
    const { manifestEntries } = await getManifest(precacheOptions)
    const precacheUrls = manifestEntries.map((entry) => entry.url)
    if (!precacheUrls.includes('index.html') || !precacheUrls.includes('manifest.webmanifest') || !precacheUrls.includes(appChangelogUrl) || !precacheUrls.some((url) => url.startsWith('assets/'))) {
      throw new Error('Application shell assets are missing from the precache manifest.')
    }
    if (manifestEntries.some((entry) => (entry.url.startsWith('_generated/') && entry.url !== appChangelogUrl) || entry.url.startsWith('media/'))) {
      throw new Error('Runtime content leaked into the application precache.')
    }
    await injectManifest({
      ...precacheOptions,
      swSrc: source,
      swDest: resolve(distDirectory, 'sw.js'),
    })
    const serviceWorker = await readFile(resolve(distDirectory, 'sw.js'), 'utf8')
    if (!serviceWorker.trim()) throw new Error('Service Worker output is empty.')
    if (serviceWorker.includes('self.__WB_MANIFEST')) throw new Error('Service Worker precache manifest was not injected.')
    if (serviceWorker.includes('process.env.NODE_ENV')) throw new Error('Service Worker contains an unresolved Node environment reference.')
    if (/createHandlerBoundToURL\((?:'|")index\.html(?:'|")\)/.test(serviceWorker)) throw new Error('Service Worker contains a top-level precache navigation handler.')
    if (!['index.html', 'manifest.webmanifest', appChangelogUrl].every((path) => serviceWorker.includes(path)) || !precacheUrls.some((url) => url.startsWith('assets/'))) {
      throw new Error('Final Service Worker is missing application shell precache entries.')
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

await main()
