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

  it('renders actual unit state independently from route role', () => {
    render(<MiniRoute label="可选节点路线" units={[
      { role: 'core', state: 'completed', completed: true },
      { role: 'optional', state: 'unread', completed: false },
      { role: 'core', state: 'completed', completed: true },
    ]} />)
    const markers = screen.getAllByTestId('route-marker')
    expect(markers.map((marker) => marker.dataset.state)).toEqual(['completed', 'unread', 'completed'])
    expect(markers[1]).toHaveAttribute('data-role', 'optional')
    expect(screen.getByRole('progressbar', { name: '可选节点路线，共 3 个节点，无已保存当前位置，2 个节点已完成' })).toBeInTheDocument()
  })

  it('keeps MiniRoute stable for empty, single and compressed routes', () => {
    const { rerender } = render(<MiniRoute units={[]} label="空路线" />)
    expect(screen.getByRole('progressbar', { name: '空路线，共 0 个节点，无已保存当前位置，0 个节点已完成' })).toBeInTheDocument()
    rerender(<MiniRoute units={[{ role: 'core', state: 'completed', completed: true }]} label="单节点路线" />)
    expect(screen.getAllByTestId('route-marker')).toHaveLength(1)
    const units = Array.from({ length: 15 }, (_, index) => ({
      role: index === 8 ? 'optional' as const : 'core' as const,
      state: index === 7 ? 'current' as const : index === 1 || index === 8 ? 'completed' as const : 'unread' as const,
      completed: index === 1 || index === 7 || index === 8,
    }))
    rerender(<MiniRoute units={units} label="长路线" />)
    const markers = screen.getAllByTestId('route-marker')
    expect(markers).toHaveLength(12)
    expect(markers.find((marker) => marker.dataset.state === 'current')).toHaveAttribute('data-source-index', '7')
    expect(markers.find((marker) => marker.dataset.sourceIndex === '8')).toHaveAttribute('data-state', 'completed')
    expect(markers.find((marker) => marker.dataset.sourceIndex === '8')).toHaveAttribute('data-role', 'optional')
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
