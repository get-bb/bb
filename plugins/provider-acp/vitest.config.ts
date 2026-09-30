import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    silent: "passed-only",
    name: "bb-plugin-provider-acp",
    include: ["*.test.ts", "src/**/*.test.ts"],
    exclude: ["node_modules/**"],
  },
});
