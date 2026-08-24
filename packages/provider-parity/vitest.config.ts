import { defineWorkspaceTestConfig } from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    name: "@bb/provider-parity",
    include: ["src/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    // Every replay cell is its own bridge child that mostly waits on
    // settle/drain pacing, so the suite is wall-clock bound by how many are
    // in flight. Pinned to 4 CPUs, 43 cells took 37s at vitest's default of
    // 5, 21s at 10, and 15s at 16, all green.
    maxConcurrency: 16,
  },
});
