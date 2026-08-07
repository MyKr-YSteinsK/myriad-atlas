import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { knowledgeFingerprint, isKnowledgeSemanticFile, type KnowledgeFingerprintManifest } from '../../src/lib/knowledge-fingerprint'
import { buildAllContent } from './build-all'

interface Snapshot {
  manifest: KnowledgeFingerprintManifest & { files: Array<KnowledgeFingerprintManifest['files'][number]> }
  fingerprint: string
}

async function buildSnapshot(root: string): Promise<Snapshot> {
  const publicDirectory = resolve(root, 'public')
  const targetRoot = resolve(publicDirectory, '_generated')
  await buildAllContent({ publicDirectory, targetRoot })
  const manifest = JSON.parse(await readFile(resolve(targetRoot, 'content-manifest.json'), 'utf8')) as Snapshot['manifest']
  return { manifest, fingerprint: await knowledgeFingerprint(manifest) }
}

function changedPaths(first: Snapshot['manifest'], second: Snapshot['manifest']): string[] {
  const left = new Map(first.files.map((file) => [file.path, file]))
  const right = new Map(second.files.map((file) => [file.path, file]))
  return [...new Set([...left.keys(), ...right.keys()])]
    .filter((path) => {
      const before = left.get(path)
      const after = right.get(path)
      return before?.kind !== after?.kind || before?.bytes !== after?.bytes || before?.sha256 !== after?.sha256
    })
    .sort((leftPath, rightPath) => leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0)
}

export async function checkContentReproducibility(): Promise<void> {
  const root = await mkdtemp(resolve(tmpdir(), 'myriad-reproducibility-'))
  try {
    const first = await buildSnapshot(resolve(root, 'first'))
    const second = await buildSnapshot(resolve(root, 'second'))
    if (first.fingerprint !== second.fingerprint) {
      throw new Error('Core knowledge fingerprint changed across identical builds.')
    }
    const drift = changedPaths(first.manifest, second.manifest)
    if (drift.length === 0) return
    const files = new Map([...first.manifest.files, ...second.manifest.files].map((file) => [file.path, file]))
    const core = drift.filter((path) => {
      const file = files.get(path)
      return file ? isKnowledgeSemanticFile(file) : true
    })
    if (core.length > 0) throw new Error(`Core knowledge artifacts changed across identical builds: ${core.join(', ')}`)
    console.warn(`Derived artifact drift across identical builds: ${drift.join(', ')}`)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const isDirectExecution = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isDirectExecution) {
  checkContentReproducibility().then(() => console.log('Knowledge build reproducibility check passed.')).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
