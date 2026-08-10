import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AtlasMiniMap, MetricBar, MiniRoute, ProgressTrack, StateGlyph } from '../../src/app/components/visual'

describe('Atlas visual primitives', () => {
  it('exposes clamped ProgressTrack values to assistive technology', () => {
    render(<ProgressTrack ratio={1.5} label="阅读进度" />)
    const track = screen.getByRole('progressbar', { name: '阅读进度' })
    expect(track).toHaveAttribute('aria-valuenow', '1')
    expect(track).toHaveAttribute('aria-valuetext', '100%')
  })

  it('renders a StateGlyph without visible status text', () => {
    const { container } = render(<StateGlyph state="unknown" />)
    expect(container.querySelector('.state-glyph')).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('.state-glyph-label')).toBeNull()
    expect(screen.getByText('不会／追问')).toHaveClass('sr-only')
  })

  it('keeps MiniRoute stable for empty, single and compressed routes', () => {
    const { rerender } = render(<MiniRoute count={0} completed={0} label="空路线" />)
    expect(screen.getByRole('progressbar', { name: '空路线，已完成 0 / 0' })).toBeInTheDocument()
    rerender(<MiniRoute count={1} completed={1} label="单节点路线" />)
    expect(screen.getAllByTestId('route-marker')).toHaveLength(1)
    rerender(<MiniRoute count={20} currentIndex={11} completed={11} label="长路线" />)
    expect(screen.getAllByTestId('route-marker')).toHaveLength(12)
  })

  it('clamps MetricBar to its supplied maximum', () => {
    render(<MetricBar label="节点" value={20} max={10} />)
    const metric = screen.getByRole('progressbar', { name: '节点' })
    expect(metric).toHaveAttribute('aria-valuenow', '10')
    expect(metric).toHaveAttribute('aria-valuemax', '10')
    expect(screen.getByText('10', { selector: 'output' })).toBeInTheDocument()
  })

  it('uses deterministic atlas positions and an honest empty state', () => {
    const { rerender } = render(<AtlasMiniMap center={{ id: 'current', label: '当前', state: 'current' }} nodes={[{ id: 'course', label: '课程 02', state: 'unread' }]} />)
    expect(screen.getByRole('img', { name: /中心 当前/ })).toBeInTheDocument()
    expect(document.querySelectorAll('.atlas-mini-map line')).toHaveLength(1)
    rerender(<AtlasMiniMap />)
    expect(screen.getByRole('img', { name: '暂无可展示的知识位置' })).toHaveTextContent('暂无可展示的知识位置')
  })
})
