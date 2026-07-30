import { resolve } from 'node:path'

export const repoRoot = process.cwd()
export const contentRoot = resolve(repoRoot, 'src/content')
export const dataRoot = resolve(repoRoot, 'src/data')
export const taxonomyPath = resolve(dataRoot, 'taxonomy/taxonomy.yaml')
export const routesRoot = resolve(dataRoot, 'routes')
export const mediaRoot = resolve(repoRoot, 'public/media')
export const schemasRoot = resolve(repoRoot, 'schemas')
export const generatedRoot = resolve(repoRoot, 'public/_generated')
export const publicRoot = resolve(repoRoot, 'public')
export const committedGeneratedRoot = resolve(repoRoot, 'generated')
export const PROJECT_BASE_PATH = '/myriad-atlas/'

export interface ContentWorkspace {
  repoRoot: string
  contentRoot: string
  dataRoot: string
  routesRoot: string
  taxonomyPath: string
  mediaRoot: string
  schemasRoot: string
}

export function createContentWorkspace(
  root = repoRoot,
  schemaDirectory = resolve(root, 'schemas'),
): ContentWorkspace {
  const workspaceDataRoot = resolve(root, 'src/data')
  return {
    repoRoot: root,
    contentRoot: resolve(root, 'src/content'),
    dataRoot: workspaceDataRoot,
    routesRoot: resolve(workspaceDataRoot, 'routes'),
    taxonomyPath: resolve(workspaceDataRoot, 'taxonomy/taxonomy.yaml'),
    mediaRoot: resolve(root, 'public/media'),
    schemasRoot: schemaDirectory,
  }
}

export const defaultContentWorkspace = createContentWorkspace()
