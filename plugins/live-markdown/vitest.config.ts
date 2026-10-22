import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    silent: "passed-only",
    name: "bb-plugin-bb--live-markdown",
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
