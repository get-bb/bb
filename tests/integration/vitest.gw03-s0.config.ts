import { defineWorkspaceTestConfig } from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    fileParallelism: false,
    globalSetup: ["./global-setup.ts"],
    include: ["fake/gw03-s0-candidate.test.ts"],
    isolate: false,
    name: "@bb/integration-tests:gw03-s0",
    silent: false,
    testTimeout: 180_000,
  },
});
