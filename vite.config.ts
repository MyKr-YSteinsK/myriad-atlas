import { readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/myriad-atlas/',
  plugins: [
    react(),
    {
      name: 'serve-generated-pagefind',
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
          const prefix = '/myriad-atlas/_generated/pagefind/'
          if (!pathname.startsWith(prefix)) {
            next()
            return
          }
          const relativePath = pathname.slice(prefix.length)
          if (!relativePath || relativePath.includes('..')) {
            next()
            return
          }
          try {
            const file = await readFile(resolve('public/_generated/pagefind', relativePath))
            const contentTypes: Record<string, string> = {
              '.css': 'text/css',
              '.js': 'application/javascript',
              '.json': 'application/json',
              '.wasm': 'application/wasm',
            }
            response.setHeader('Content-Type', contentTypes[extname(relativePath)] ?? 'application/octet-stream')
            response.end(file)
          } catch {
            next()
          }
        })
      },
    },
  ],
})
