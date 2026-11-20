import { defineWorkspaceTestConfig } from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    include: ["test/**/*.test.ts"],
    name: "@bb/agent-instructions-eval",
    testTimeout: 60_000,
  },
});
