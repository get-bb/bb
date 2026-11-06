import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    testTimeout: 15_000,
    globalSetup: ["test/setup/migrated-db-template.ts"],
    setupFiles: [
      "test/setup/stored-event-decode-freeze.ts",
      "test/setup/warm-test-harness.ts",
    ],
    env: {
      BB_DATA_DIR: "/tmp/bb-server-test",
      BB_SERVER_PORT: "49161",
      BB_HOST_DAEMON_PORT: "49162",
    },
    projects: [
      ...sharedWorkerProjects({
        pkgDir: __dirname,
        name: "@bb/server",
        include: ["src/**/*.test.ts", "test/**/*.test.ts"],
        exclude: [
          "dist/**",
          "node_modules/**",
          "test/services/plugins/plugin-native-server-loading.test.ts",
        ],
      }),
      {
        extends: true,
        test: {
          name: "@bb/server:native-plugin",
          include: [
            "test/services/plugins/plugin-native-server-loading.test.ts",
          ],
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
