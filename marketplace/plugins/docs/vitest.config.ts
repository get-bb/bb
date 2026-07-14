import path from "node:path";
import { defineWorkspaceTestConfig } from "../../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  resolve: {
    // Mirror the plugin tsconfig's "@/*" paths.
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
    name: "bb-plugin-simple-notes",
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**"],
  },
});
