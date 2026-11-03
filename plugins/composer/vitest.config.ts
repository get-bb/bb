import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    silent: "passed-only",
    name: "bb-plugin-bb--composer",
    include: ["**/*.test.{ts,tsx}"],
    setupFiles: ["./test-setup.ts"],
    exclude: ["node_modules/**"],
  },
});
