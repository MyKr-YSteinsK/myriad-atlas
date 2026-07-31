import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildAllContent, type ContentBuildPoint } from '../../scripts/content/build-all'
import { createContentWorkspace } from '../../scripts/content/config'

const temporaryRoots: string[] = []

async function snapshot(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const values = await Promise.all(entries.map(async (entry) => {
    const path = resolve(root, entry.name)
    if (entry.isDirectory()) return (await snapshot(path)).map((value) => `${entry.name}/${value}`)
    const bytes = await readFile(path)
    return [`${entry.name}:${createHash('sha256').update(bytes).digest('hex')}`]
  }))
  return values.flat().sort()
}

describe('atomic generated content builds', () => {
  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it.each<ContentBuildPoint>(['nodes', 'catalog', 'pagefind', 'manifest', 'before-switch'])(
    'preserves the complete previous output when %s fails',
    async (failurePoint) => {
      const root = await mkdtemp(resolve(tmpdir(), 'myriad-atomic-'))
      temporaryRoots.push(root)
      const publicDirectory = resolve(root, 'public')
      const targetRoot = resolve(publicDirectory, '_generated')
      await mkdir(targetRoot, { recursive: true })
      await writeFile(resolve(targetRoot, 'previous.txt'), 'previous-version', 'utf8')
      const before = await snapshot(targetRoot)

      await expect(buildAllContent({
        publicDirectory,
        targetRoot,
        onPoint(point) {
          if (point === failurePoint) throw new Error(`injected-${point}`)
        },
      })).rejects.toThrow(`injected-${failurePoint}`)

      expect(await snapshot(targetRoot)).toEqual(before)
      expect((await readdir(publicDirectory)).filter((name) => name.startsWith('.generated-'))).toEqual([])
    },
  )

  it('produces byte-identical formal empty-corpus output twice', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'myriad-deterministic-'))
    temporaryRoots.push(root)
    const publicDirectory = resolve(root, 'public')
    const targetRoot = resolve(publicDirectory, '_generated')
    await cp(resolve(process.cwd(), 'src/data/taxonomy'), resolve(root, 'src/data/taxonomy'), { recursive: true })
    await cp(resolve(process.cwd(), 'src/data/changelog'), resolve(root, 'src/data/changelog'), { recursive: true })
    await cp(resolve(process.cwd(), 'schemas'), resolve(root, 'schemas'), { recursive: true })
    await mkdir(resolve(root, 'src/content'), { recursive: true })
    await mkdir(resolve(root, 'src/data/routes'), { recursive: true })
    await mkdir(resolve(publicDirectory, 'media'), { recursive: true })
    await buildAllContent({ workspace: createContentWorkspace(root, resolve(root, 'schemas')), publicDirectory, targetRoot })
    const first = await snapshot(targetRoot)
    await buildAllContent({ workspace: createContentWorkspace(root, resolve(root, 'schemas')), publicDirectory, targetRoot })
    expect(await snapshot(targetRoot)).toEqual(first)
  })
})
