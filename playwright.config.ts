import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

// A Chromium already in Playwright's cache, when it is there (the build server
// has this one and must not download browsers); otherwise Playwright's own.
const cached = join(
  homedir(), '.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell');
const launchOptions = existsSync(cached) ? { executablePath: cached } : {};

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5199',
    launchOptions,
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'phone', use: { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: 'npx vite preview web --port 5199 --strictPort',
    url: 'http://localhost:5199',
    reuseExistingServer: false,
  },
});
