import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

const parsedTimeoutScale = Number(process.env.BB_TEST_TIMEOUT_SCALE ?? 1);
const timeoutScale =
  Number.isFinite(parsedTimeoutScale) && parsedTimeoutScale > 0
    ? parsedTimeoutScale
    : 1;

const projectExecutionDefaultsProjects = sharedWorkerProjects({
  pkgDir: __dirname,
  name: "@bb/integration-tests:project-execution-defaults",
  include: ["fake/smoke/project-execution-defaults.test.ts"],
}).map((project) => {
  if (typeof project !== "object" || !("test" in project)) {
    throw new Error(
      "Expected project-execution-defaults shared worker project configuration",
    );
  }
  return {
    ...project,
    test: { ...project.test, isolate: true },
  };
});

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
          fileParallelism: true,
          isolate: false,
          globalSetup: ["./global-setup.ts"],
          include: ["fake/**/*.test.ts"],
          exclude: ["fake/smoke/project-execution-defaults.test.ts"],
        },
      },
      ...projectExecutionDefaultsProjects,
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
