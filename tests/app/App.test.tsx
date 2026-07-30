import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '../../src/app/router'

describe('application shell', () => {
  it('shows the project identity without Vite starter content', () => {
    render(<AppRouter />)

    expect(screen.getByRole('heading', { level: 1, name: '万象回廊 · MyKr' })).toBeInTheDocument()
    expect(screen.queryByText(/vite/i)).not.toBeInTheDocument()
  })
})
