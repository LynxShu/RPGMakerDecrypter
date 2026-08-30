import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: true
  },
  resolve: {
    alias: {
      '@lib': resolve(__dirname, 'src/lib')
    }
  }
})
