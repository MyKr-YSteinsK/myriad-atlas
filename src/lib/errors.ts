export type ContentErrorKind = 'application' | 'missing' | 'network' | 'offline' | 'malformed' | 'unsupported-version'

export class ContentClientError extends Error {
  constructor(readonly kind: ContentErrorKind, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ContentClientError'
  }
}
