import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globalSetup: ["@get-bb/plugin-sdk/testing/vitest-global-setup"],
    silent: "passed-only",
    name: "bb-plugin-concurrency-limit",
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
