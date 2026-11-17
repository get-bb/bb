import { defineWorkspaceTestConfig } from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    name: "@bb/render-invariants",
    include: ["src/**/*.test.ts"],
    globalSetup: ["../integration/global-setup.ts"],
    fileParallelism: true,
    maxWorkers: 3,
    hookTimeout: 240_000,
    testTimeout: 90_000,
    env: {
      BB_DATA_DIR: "/tmp/bb-render-invariants-test",
      BB_SERVER_PORT: "49171",
      BB_SERVER_URL: "http://127.0.0.1:49171",
      BB_HOST_DAEMON_PORT: "49172",
    },
  },
});
