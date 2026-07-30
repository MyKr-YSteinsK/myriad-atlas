import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { App } from '../../src/app/App'
import { parseNodeContext } from '../../src/app/data/node-context'
import type { RuntimeCatalog, RuntimeRoutesIndex, RuntimeTaxonomy } from '../../src/content/types'

const data = {
  catalog: { schema_version: 1, content_version: 'v', nodes: [] } as RuntimeCatalog,
  taxonomy: {
    schema_version: 1,
    content_version: 'v',
    domains: [{ id: 'domain', name: '领域', courses: [{ id: 'course', name: '课程', node_count: 0, node_ids: [] }] }],
  } as RuntimeTaxonomy,
  routes: {
    schema_version: 1,
    content_version: 'v',
    routes: [{ id: 'route', code: 'R', name: '路线', summary: '摘要', route_path: '_generated/routes/route.json', core_anchor_count: 0 }],
  } as RuntimeRoutesIndex,
}

describe('application routes and node context', () => {
  it('renders an explicit not-found page', () => {
    render(<MemoryRouter initialEntries={['/unknown-path']}><App /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: '页面不存在' })).toBeInTheDocument()
  })
  it('registers the planned route list', () => {
    render(<MemoryRouter initialEntries={['/me/pending-removals']}><App /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: '待删除' })).toBeInTheDocument()
  })
  it('accepts only validated route and course context without return URLs', () => {
    expect(parseNodeContext(new URLSearchParams('source=course&domain=domain&course=course'), data)).toEqual({
      source: 'course', domainId: 'domain', courseId: 'course',
    })
    expect(parseNodeContext(new URLSearchParams('source=route&route=route&stage=s&module=m'), data)).toEqual({
      source: 'route', routeId: 'route', stageId: 's', moduleId: 'm',
    })
    expect(parseNodeContext(new URLSearchParams('source=course&domain=bad&return=https://evil.test'), data)).toBeUndefined()
  })
})
