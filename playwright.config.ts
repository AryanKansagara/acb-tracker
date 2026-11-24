import { defineConfig, devices } from '@playwright/test'

// Tests run against the production build served by `vite preview`, never the dev server.
const PORT = Number(process.env.E2E_PORT ?? 4389)
const origin = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: origin, trace: 'retain-on-failure', serviceWorkers: 'block' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: origin,
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
