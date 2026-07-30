export const PROJECT_BASE_PATH = '/myriad-atlas/'

export function basePath(path = ''): string {
  const base = import.meta.env.BASE_URL || PROJECT_BASE_PATH
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
}

export function nodeHashPath(nodeId: string): string {
  return `#/node/${encodeURIComponent(nodeId)}`
}
