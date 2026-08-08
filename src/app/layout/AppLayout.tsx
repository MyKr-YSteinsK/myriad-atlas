import { useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { AtlasLink } from '../components/AtlasLink'
import { Icon, type IconName } from '../components/Icon'
import { canUseViewTransitions } from '../components/view-transitions'

const navigation = [
  { to: '/', label: '首页', icon: 'home', end: true },
  { to: '/routes', label: '路线', icon: 'route' },
  { to: '/library', label: '知识库', icon: 'library' },
  { to: '/roaming', label: '随机漫游', icon: 'roam' },
  { to: '/me', label: '我的', icon: 'me' },
]

function sectionName(pathname: string) {
  if (pathname.startsWith('/route')) return '路线'
  if (pathname.startsWith('/library')) return '知识库'
  if (pathname.startsWith('/map')) return '知识航图'
  if (pathname.startsWith('/roaming')) return '随机漫游'
  if (pathname.startsWith('/search')) return '搜索'
  if (pathname.startsWith('/me')) return '我的'
  return '知识总览'
}

export function AppLayout() {
  const location = useLocation()
  useEffect(() => {
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>('.atlas-main h1')?.focus())
  }, [location.pathname])
  return <div className="atlas-shell">
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    <header className="atlas-topbar">
      <AtlasLink className="atlas-brand" to="/" aria-label="返回万象回廊首页"><strong>MyKr</strong><span>万象回廊</span></AtlasLink>
      <p className="atlas-context" aria-live="polite">{sectionName(location.pathname)}</p>
      <AtlasLink className="atlas-search-link" to="/search?focus=1" aria-label="打开全文搜索">
        <Icon name="search" /><span>搜索</span>
      </AtlasLink>
    </header>
    <nav className="atlas-nav" aria-label="主要导航">
      {navigation.map((item) => <NavLink key={item.to} to={item.to} end={item.end} viewTransition={canUseViewTransitions()}>
        {({ isActive }) => <><span className="atlas-nav-icon"><Icon name={item.icon as IconName} />{isActive && <i aria-hidden="true" />}</span><span>{item.label}</span></>}
      </NavLink>)}
    </nav>
    <main id="main-content" className="atlas-main" key={location.pathname}><Outlet /></main>
  </div>
}
