import path from "node:path";
import { defineWorkspaceTestConfig } from "../../vitest.shared.js";

// Pure-logic tests only (node environment). Screen behavior is covered by
// Maestro flows under e2e/flows. Modules under test must not import
// react-native.
export default defineWorkspaceTestConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    silent: "passed-only",
    environment: "node",
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
    testTimeout: 15_000,
  },
});
