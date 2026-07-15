import path from "node:path";
import { defineWorkspaceTestConfig } from "../../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  resolve: {
    alias: {
      "@bb/plugin-sdk": path.resolve(
        import.meta.dirname,
        "../../../packages/plugin-sdk/src",
      ),
    },
  },
  test: {
    silent: "passed-only",
    name: "bb-plugin-github",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**"],
  },
});
