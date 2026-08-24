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
    },
    silent: "passed-only",
    testTimeout: Math.ceil(60_000 * timeoutScale),
    projects: [
      {
        extends: true,
        test: {
          name: "@bb/integration-tests",
          // Fake integration suites isolate temp roots, ports, and in-memory
          // state, so we can safely parallelize across files for a large
          // runtime win.
          fileParallelism: true,
          // No file here mocks modules or stubs globals/env
          // (vitest.shared.ts's partitionTestFiles would flag it), so workers
          // can reuse their context across files instead of re-importing the
          // server graph per file.
          isolate: false,
          globalSetup: ["./global-setup.ts"],
          include: ["fake/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          // The golden test stubs env per variant, so it keeps the default
          // isolated worker.
          name: "@bb/integration-tests:native-roots-golden",
          include: ["native-roots-golden/**/*.test.ts"],
        },
      },
    ],
  },
});
