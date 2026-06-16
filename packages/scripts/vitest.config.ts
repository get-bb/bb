import { defineWorkspaceTestConfig } from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    name: "@bb/scripts",
    include: ["test/**/*.test.ts", "test/**/*.test.mjs"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
