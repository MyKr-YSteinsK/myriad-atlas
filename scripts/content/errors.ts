export type IssueSeverity = 'error' | 'warning'

export interface ContentIssue {
  code: string
  severity: IssueSeverity
  sourcePath: string
  nodeId?: string
  message: string
}

export function issue(
  severity: IssueSeverity,
  code: string,
  sourcePath: string,
  message: string,
  nodeId?: string,
): ContentIssue {
  return { severity, code, sourcePath, message, ...(nodeId ? { nodeId } : {}) }
}
