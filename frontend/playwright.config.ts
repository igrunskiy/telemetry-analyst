import { defineConfig } from '@playwright/test'
import path from 'path'

const repoRoot = path.resolve(__dirname, '..')

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: {
    timeout: 20_000,
  },
  retries: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost',
    trace: 'on-first-retry',
  },
  globalSetup: './e2e/global-setup',
  globalTeardown: './e2e/global-teardown',
  outputDir: path.join(repoRoot, 'playwright-results'),
})
