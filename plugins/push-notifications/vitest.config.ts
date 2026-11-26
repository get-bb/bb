import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["@get-bb/plugin-sdk/testing/vitest-global-setup"],
    silent: "passed-only",
    name: "bb-plugin-push-notifications",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
