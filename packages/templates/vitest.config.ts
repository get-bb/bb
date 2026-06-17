import { defineWorkspaceTestConfig } from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    name: "@bb/templates",
    include: ["test/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
