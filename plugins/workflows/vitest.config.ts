import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globalSetup: ["@get-bb/plugin-sdk/testing/vitest-global-setup"],
    name: "bb-plugin-workflows",
    environment: "node",
    testTimeout: 15_000,
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
