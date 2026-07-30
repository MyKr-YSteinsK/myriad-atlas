import { rm, readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'vite'
import { getManifest, injectManifest } from 'workbox-build'

const repositoryRoot = resolve('.')
const distDirectory = resolve(repositoryRoot, 'dist')
const temporaryDirectory = resolve(distDirectory, '.sw-build')

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
    const precacheOptions = {
      globDirectory: distDirectory,
      globPatterns: ['**/*.{html,js,css,png,svg,webmanifest,ico}'],
      globIgnores: ['sw.js', '.sw-build/**', '_generated/**', 'media/**', '**/*.map'],
    }
    const { manifestEntries } = await getManifest(precacheOptions)
    const precacheUrls = manifestEntries.map((entry) => entry.url)
    if (!precacheUrls.includes('index.html') || !precacheUrls.includes('manifest.webmanifest') || !precacheUrls.some((url) => url.startsWith('assets/'))) {
      throw new Error('Application shell assets are missing from the precache manifest.')
    }
    if (manifestEntries.some((entry) => entry.url.startsWith('_generated/') || entry.url.startsWith('media/'))) {
      throw new Error('Runtime content leaked into the application precache.')
    }
    await injectManifest({
      ...precacheOptions,
      swSrc: source,
      swDest: resolve(distDirectory, 'sw.js'),
    })
    const serviceWorker = await readFile(resolve(distDirectory, 'sw.js'), 'utf8')
    if (serviceWorker.includes('self.__WB_MANIFEST')) throw new Error('Service Worker precache manifest was not injected.')
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

await main()
