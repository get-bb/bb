import { defineWorkspaceTestConfig } from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    name: "@bb/agent-runtime",
    include: ["src/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**", "src/integration*.test.ts"],
  },
});
