export function canUseViewTransitions() {
  return typeof document !== 'undefined'
    && 'startViewTransition' in document
    && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}
