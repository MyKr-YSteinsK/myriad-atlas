import { readdir } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

export async function findFiles(root: string, extension: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = resolve(root, entry.name)
    if (entry.isDirectory()) return findFiles(fullPath, extension)
    return entry.isFile() && entry.name.endsWith(extension) ? [fullPath] : []
  }))
  return nested.flat().sort()
}

export function relativePosix(from: string, target: string): string {
  return relative(from, target).replaceAll('\\', '/')
}

export function isSafeNodeId(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
}
