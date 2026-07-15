import path from "node:path";
import { defineWorkspaceTestConfig } from "../../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
  test: {
    silent: "passed-only",
    name: "bb-plugin-memory",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules/**"],
  },
});
