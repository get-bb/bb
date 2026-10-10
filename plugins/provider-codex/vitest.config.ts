import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    silent: "passed-only",
    name: "bb-plugin-provider-codex",
    include: ["src/**/*.test.ts", "app.test.tsx"],
    exclude: ["node_modules/**"],
  },
});
