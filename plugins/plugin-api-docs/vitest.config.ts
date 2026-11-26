import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globalSetup: ["@get-bb/plugin-sdk/testing/vitest-global-setup"],
    silent: "passed-only",
    name: "bb-plugin-plugin-api-docs",
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**"],
    setupFiles: ["./test/setup.ts"],
  },
});
