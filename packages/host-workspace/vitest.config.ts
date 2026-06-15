import { defineWorkspaceTestConfig } from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    name: "@bb/host-workspace",
    include: ["test/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    // Several tests drive real git subprocesses (concurrent reset/checkout,
    // stash) that run fast in isolation but can exceed the 5s default under
    // full-suite CPU contention. Match the 15s used by other subprocess-heavy
    // packages (@bb/host-daemon, @bb/app, @bb/logger).
    testTimeout: 15_000,
  },
});
