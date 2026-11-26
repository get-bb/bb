import { defineWorkspaceTestConfig } from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    name: "@bb/tunnel-client",
    ...(process.env.VITEST_MAX_WORKERS
      ? { maxWorkers: Number(process.env.VITEST_MAX_WORKERS) }
      : {}),
    include: ["test/**/*.test.ts"],
  },
});
