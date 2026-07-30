import { PROJECT_BASE_PATH as protocolBasePath } from '../pwa/cache-protocol'

export const PROJECT_BASE_PATH = protocolBasePath

export function basePath(path = ''): string {
  return `${PROJECT_BASE_PATH.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
}

export function nodeHashPath(nodeId: string): string {
  return `#/node/${encodeURIComponent(nodeId)}`
}
