import { readdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { generatedRoot, publicRoot } from './content/config'

await rm(generatedRoot, { recursive: true, force: true })
for (const entry of await readdir(publicRoot, { withFileTypes: true })) {
  if (entry.isDirectory() && (entry.name.startsWith('.generated-staging-') || entry.name.startsWith('.generated-backup-'))) {
    await rm(resolve(publicRoot, entry.name), { recursive: true, force: true })
  }
}
