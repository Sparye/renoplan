import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: 'http://localhost:4173' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'bun --bun vite build && bun --bun vite preview --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: true
  }
});
