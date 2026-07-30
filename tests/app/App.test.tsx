import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '../../src/app/router'

describe('application shell', () => {
  it('shows the project identity without Vite starter content', () => {
    render(<AppRouter />)

    expect(screen.getByRole('heading', { level: 1, name: '万象回廊 · MyKr' })).toBeInTheDocument()
    expect(screen.queryByText(/vite/i)).not.toBeInTheDocument()
  })

  it('exposes the fixed five-item navigation and global search entry', () => {
    render(<AppRouter />)
    const navigation = screen.getByRole('navigation', { name: '主要导航' })
    expect(Array.from(navigation.querySelectorAll('a')).map((link) => link.textContent)).toEqual([
      '首页', '路线', '知识库', '随机漫游', '我的',
    ])
    expect(screen.getByRole('link', { name: '首页' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: '打开全文搜索' })).toHaveAttribute('href', '#/search?focus=1')
  })
})
