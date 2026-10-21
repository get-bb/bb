import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:61000",
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: "pnpm storybook --port 61000",
    url: "http://127.0.0.1:61000/meta.json",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
