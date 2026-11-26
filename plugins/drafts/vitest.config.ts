import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["@get-bb/plugin-sdk/testing/vitest-global-setup"],
    silent: "passed-only",
    name: "bb-plugin-drafts",
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**"],
  },
});
