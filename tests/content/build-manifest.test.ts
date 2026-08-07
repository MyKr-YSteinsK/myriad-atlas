import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildManifest } from '../../scripts/content/build-manifest'

describe('content manifest publishing filter', () => {
  it('excludes media placeholders while retaining normal media', async () => {
    const root = await mkdtemp(join(tmpdir(), 'myriad-manifest-'))
    const outputRoot = resolve(root, 'generated')
    const mediaRoot = resolve(root, 'media')
    await mkdir(outputRoot, { recursive: true })
    await mkdir(mediaRoot, { recursive: true })
    await writeFile(resolve(outputRoot, 'app-changelog.json'), '{"current_version":"0.4.0"}')
    await writeFile(resolve(mediaRoot, '.gitkeep'), '')
    await writeFile(resolve(mediaRoot, 'cover.png'), 'media')

    const manifest = await buildManifest('2026.07.30-01', outputRoot, mediaRoot)

    expect(manifest.files.map((file) => file.path)).not.toContain('media/.gitkeep')
    expect(manifest.files.map((file) => file.path)).not.toContain('_generated/app-changelog.json')
    expect(manifest.files).toContainEqual(expect.objectContaining({ path: 'media/cover.png', kind: 'media' }))
    await rm(root, { recursive: true, force: true })
  })
})
