import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globalSetup: ["@get-bb/plugin-sdk/testing/vitest-global-setup"],
    silent: "passed-only",
    name: "bb-plugin-provider-pi",
    include: ["*.test.ts", "*.test.tsx", "src/**/*.test.ts"],
    exclude: ["node_modules/**"],
  },
});
