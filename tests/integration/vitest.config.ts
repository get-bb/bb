import { defineWorkspaceTestConfig } from "../../vitest.shared.js";

const parsedTimeoutScale = Number(process.env.BB_TEST_TIMEOUT_SCALE ?? 1);
const timeoutScale =
  Number.isFinite(parsedTimeoutScale) && parsedTimeoutScale > 0
    ? parsedTimeoutScale
    : 1;

export default defineWorkspaceTestConfig({
  test: {
    hookTimeout: Math.ceil(60_000 * timeoutScale),
    env: {
      BB_DATA_DIR: "/tmp/bb-integration-test",
      BB_SERVER_PORT: "49161",
      BB_SERVER_URL: "http://127.0.0.1:49161",
      BB_HOST_DAEMON_PORT: "49162",
      SCRIPTED_ECHO_OPTIONS: JSON.stringify({ uniqueProviderThreadIds: true }),
    },
    silent: "passed-only",
    testTimeout: Math.ceil(60_000 * timeoutScale),
    projects: [
      {
        extends: true,
        test: {
          name: "@bb/integration-tests",
          // bb-fork(windows): full-stack files in parallel starve each other, so
          // run them sequentially with a distinct group order.
          fileParallelism: process.platform !== "win32",
          ...(process.platform === "win32"
            ? { sequence: { groupOrder: 1 } }
            : {}),
          isolate: false,
          globalSetup: ["./global-setup.ts"],
          include: ["fake/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "@bb/integration-tests:native-roots-golden",
          include: ["native-roots-golden/**/*.test.ts"],
        },
      },
    ],
  },
});
