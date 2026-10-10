import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    silent: "passed-only",
    name: "bb-plugin-bb--provider-acp-next",
    include: ["*.test.ts", "*.test.tsx", "src/**/*.test.ts"],
    exclude: ["node_modules/**"],
  },
});
