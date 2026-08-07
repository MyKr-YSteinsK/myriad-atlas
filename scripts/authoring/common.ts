import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'

export const AUTHORING_ROOT = 'inbox/authoring'
export const ALLOWED_AUTHORING_ROOTS = ['src/content/', 'src/data/routes/', 'public/media/'] as const

export function fail(message: string): never { throw new Error(`作者工具：${message}`) }
export function hash(bytes: Buffer | string): string { return createHash('sha256').update(bytes).digest('hex') }
export function posixRelative(root: string, path: string): string { return relative(root, path).replaceAll('\\', '/') }

export function authoringPath(root: string, path: string): string {
  const absolute = resolve(root, path)
  const allowed = resolve(root, AUTHORING_ROOT)
  if (!absolute.startsWith(`${allowed}${sep}`)) fail('workspace 必须位于 inbox/authoring/ 下')
  return absolute
}

export async function regularFiles(root: string): Promise<string[]> {
  const metadata = await lstat(root).catch(() => undefined)
  if (!metadata) return []
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) fail(`目录不是普通目录：${root}`)
  const values: string[] = []
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const path = resolve(root, entry.name)
    if (entry.isSymbolicLink()) fail(`不允许符号链接：${path}`)
    if (entry.isDirectory()) values.push(...await regularFiles(path))
    else if (entry.isFile()) values.push(path)
    else fail(`不允许非普通文件：${path}`)
  }
  return values
}

export async function readNodeId(path: string): Promise<string> {
  const { parseFrontmatter } = await import('../content/parse-frontmatter')
  const data = parseFrontmatter(await readFile(path, 'utf8')).data
  if (typeof data.id !== 'string') fail(`节点缺少 id：${path}`)
  return data.id
}
