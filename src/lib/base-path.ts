export const PROJECT_BASE_PATH = '/myriad-atlas/'

export function basePath(path = ''): string {
  return `${PROJECT_BASE_PATH.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
}

export function nodeHashPath(nodeId: string): string {
  return `#/node/${encodeURIComponent(nodeId)}`
}
