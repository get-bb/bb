import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    name: "bb-plugin-browser-automation",
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
