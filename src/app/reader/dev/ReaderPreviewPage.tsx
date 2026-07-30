import { ReaderPage } from '../ReaderPage'
import { previewNode } from './fixture'

export default function ReaderPreviewPage() {
  return <ReaderPage node={previewNode} catalog={{ schema_version: 1, content_version: 'preview', nodes: [] }} />
}
