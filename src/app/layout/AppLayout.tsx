import { useEffect } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'

const navigation = [
  { to: '/', label: '首页', end: true },
  { to: '/routes', label: '路线' },
  { to: '/library', label: '知识库' },
  { to: '/roaming', label: '随机漫游' },
  { to: '/map', label: '知识地图' },
  { to: '/me', label: '我的' },
]

function AtlasIcon({ position }: { position: number }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" /><path d={`M4 12h16M12 4v16M${7 + position} 8v8`} fill="none" stroke="currentColor" /></svg>
}

export function AppLayout() {
  const location = useLocation()
  useEffect(() => {
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>('.atlas-main h1')?.focus())
  }, [location.pathname])
  return <div className="atlas-shell">
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    <header className="atlas-topbar">
      <p>万象回廊 · MyKr</p>
      <Link className="atlas-search-link" to="/search?focus=1" aria-label="打开全文搜索">
        <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" /><path d="m15.5 15.5 5 5" stroke="currentColor" /></svg>
        <span>搜索</span>
      </Link>
    </header>
    <nav className="atlas-nav" aria-label="主要导航">
      {navigation.map((item, index) => <NavLink key={item.to} to={item.to} end={item.end}>
        {({ isActive }) => <><AtlasIcon position={index} /><span>{item.label}</span>{isActive && <i aria-hidden="true" />}</>}
      </NavLink>)}
    </nav>
    <main id="main-content" className="atlas-main" key={location.pathname}><Outlet /></main>
  </div>
}
