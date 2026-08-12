import { defineWorkspaceTestConfig } from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    name: "bb-plugin-simple-notes",
    // The full jsdom app suite runs alongside the other package tests in CI.
    // Give CPU-heavy UI tests the same budget as the main app suite.
    testTimeout: 15_000,
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**"],
  },
});
