import { resolve } from 'node:path'
import { buildAllContent } from '../content/build-all'
import { createContentWorkspace, publicRoot, repoRoot, schemasRoot } from '../content/config'

const fixtureRoot = resolve(repoRoot, 'tests/fixtures/valid-corpus')
await buildAllContent({
  workspace: createContentWorkspace(fixtureRoot, schemasRoot),
  publicDirectory: publicRoot,
})
console.log('Built APP_FIXTURE_ONLY runtime content.')
