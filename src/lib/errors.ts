export type ContentErrorKind = 'application' | 'missing' | 'network' | 'malformed' | 'unsupported-version'

export class ContentClientError extends Error {
  constructor(readonly kind: ContentErrorKind, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ContentClientError'
  }
}
