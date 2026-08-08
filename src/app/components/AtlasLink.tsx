import { Link, type LinkProps } from 'react-router-dom'
import { canUseViewTransitions } from './view-transitions'

export function AtlasLink(props: LinkProps) {
  return <Link {...props} viewTransition={canUseViewTransitions()} />
}
