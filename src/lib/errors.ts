export type ContentErrorKind = 'application' | 'missing' | 'network' | 'malformed' | 'unsupported-version'

export class ContentClientError extends Error {
  constructor(readonly kind: ContentErrorKind, message: string) {
    super(message)
    this.name = 'ContentClientError'
  }
}
