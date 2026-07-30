import { resolve } from 'node:path'

export const repoRoot = process.cwd()
export const contentRoot = resolve(repoRoot, 'src/content')
export const dataRoot = resolve(repoRoot, 'src/data')
export const taxonomyPath = resolve(dataRoot, 'taxonomy/taxonomy.yaml')
export const routesRoot = resolve(dataRoot, 'routes')
export const mediaRoot = resolve(repoRoot, 'public/media')
export const schemasRoot = resolve(repoRoot, 'schemas')
export const generatedRoot = resolve(repoRoot, 'public/_generated')
export const PROJECT_BASE_PATH = '/myriad-atlas/'
