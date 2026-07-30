import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { ReaderPage } from '../../src/app/reader/ReaderPage'
import { readerDb } from '../../src/app/state/reader-db'
import { previewNode } from '../../src/app/reader/dev/fixture'

describe('immersive reader', () => {
  beforeEach(async () => {
    await readerDb.delete()
    await readerDb.open()
    window.scrollTo = () => undefined
    HTMLElement.prototype.scrollIntoView = () => undefined
  })

  it('keeps body before takeaways and self-check answers collapsed by default', async () => {
    render(<MemoryRouter><ReaderPage node={previewNode} catalog={{ schema_version: 1, content_version: 'preview', nodes: [] }} /></MemoryRouter>)
    const body = document.querySelector('.reader-body')!
    const takeaways = screen.getByRole('heading', { name: '要点' })
    const actions = screen.getByRole('heading', { name: '节点状态' })
    const details = screen.getByText('为什么答案默认折叠？').closest('details')!

    expect(body.compareDocumentPosition(takeaways) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(takeaways.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(details).not.toHaveAttribute('open')
    await userEvent.click(screen.getByText('为什么答案默认折叠？'))
    expect(details).toHaveAttribute('open')
  })

  it('previews settings immediately and restores readable defaults', async () => {
    const user = userEvent.setup()
    const { container } = render(<MemoryRouter><ReaderPage node={previewNode} catalog={{ schema_version: 1, content_version: 'preview', nodes: [] }} /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: '阅读设置' }))
    fireEvent.change(screen.getByRole('slider', { name: '字号' }), { target: { value: '21' } })
    await user.click(screen.getByLabelText('暖色'))
    await user.click(screen.getByLabelText('代码换行'))
    const reader = container.querySelector('.reader') as HTMLElement

    expect(reader.style.getPropertyValue('--reader-font-size')).toBe('21px')
    expect(reader).toHaveClass('reader-code-wrap')
    expect(document.documentElement.dataset.theme).toBe('warm')
    await user.click(screen.getByRole('button', { name: '恢复默认' }))
    expect(reader.style.getPropertyValue('--reader-font-size')).toBe('18px')
    expect(reader).not.toHaveClass('reader-code-wrap')
  })

  it('flushes the latest reading position on pagehide and unmount', async () => {
    const view = render(<MemoryRouter><ReaderPage node={previewNode} catalog={{ schema_version: 1, content_version: 'preview', nodes: [] }} /></MemoryRouter>)
    fireEvent.scroll(window)
    fireEvent(window, new Event('pagehide'))
    await waitFor(async () => expect((await readerDb.nodeStates.get(previewNode.id))?.reading_progress).toBeTruthy())
    view.unmount()
    await waitFor(async () => expect((await readerDb.nodeStates.get(previewNode.id))?.completed).toBe(false))
  })
  it('flushes a pending reader setting during a fast unmount', async () => {
    const view = render(<MemoryRouter><ReaderPage node={previewNode} catalog={{ schema_version: 1, content_version: 'preview', nodes: [] }} /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: '阅读设置' }))
    fireEvent.change(screen.getByRole('slider', { name: '字号' }), { target: { value: '21' } })
    view.unmount()
    await waitFor(async () => expect((await readerDb.settings.get('reader.preferences'))?.value.fontSize).toBe(21))
  })
})
