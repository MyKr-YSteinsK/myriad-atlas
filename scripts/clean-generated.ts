import { rm } from 'node:fs/promises'
import { generatedRoot } from './content/config'

await rm(generatedRoot, { recursive: true, force: true })
