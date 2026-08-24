import { defineWorkspaceTestConfig } from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    include: ["test/**/*.test.ts"],
    name: "@bb/qa",
    // These suites spawn real child processes; the 5s default tipped over
    // when the whole workspace ran at once.
    testTimeout: 15_000,
  },
});
