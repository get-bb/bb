import { defineWorkspaceTestConfig } from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    include: ["src/**/*.test.ts"],
    name: "@bb/thread-streaming-bench",
    testTimeout: 15_000,
  },
});
