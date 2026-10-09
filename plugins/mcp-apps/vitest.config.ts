import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "bb-plugin-mcp-apps",
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**"],
  },
});
