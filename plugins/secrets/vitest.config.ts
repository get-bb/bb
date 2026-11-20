import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    globalSetup: ["@get-bb/plugin-sdk/testing/vitest-global-setup"],
  },
});
