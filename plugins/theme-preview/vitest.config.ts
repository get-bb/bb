import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    name: "bb-plugin-theme-preview",
    testTimeout: 20_000,
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**"],
  },
});
