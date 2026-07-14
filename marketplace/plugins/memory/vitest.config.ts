import path from "node:path";
import { defineWorkspaceTestConfig } from "../../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
      "@bb/plugin-sdk": path.resolve(
        import.meta.dirname,
        "../../../packages/plugin-sdk/src",
      ),
    },
  },
  test: {
    silent: "passed-only",
    name: "bb-plugin-memory",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules/**"],
  },
});
