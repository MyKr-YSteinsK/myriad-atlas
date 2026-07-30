import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/myriad-atlas/',
  plugins: [react()],
})
