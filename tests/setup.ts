import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(cleanup)

if (!window.requestAnimationFrame) window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(Date.now()), 0)
