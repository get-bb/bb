import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    // bb-fork(windows): git fixture setup is slower than the 5s default.
    testTimeout: 30_000,
    setupFiles: [
      "test/setup/stored-event-decode-freeze.ts",
      "test/setup/warm-test-harness.ts",
    ],
    env: {
      BB_DATA_DIR: "/tmp/bb-server-test",
      BB_SERVER_PORT: "49161",
      BB_HOST_DAEMON_PORT: "49162",
      // bb-fork(windows): ignore host git config and allow the long plugin
      // cache paths the git update fixtures build.
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.longpaths",
      GIT_CONFIG_VALUE_0: "true",
    },
    projects: sharedWorkerProjects({
      pkgDir: __dirname,
      name: "@bb/server",
      include: ["src/**/*.test.ts", "test/**/*.test.ts"],
      // bb-fork(windows): Linux/macOS service installers and server moves are
      // POSIX-only.
      exclude: [
        "dist/**",
        "node_modules/**",
        ...(process.platform === "win32"
          ? ["test/app/install-machine-script.test.ts", "test/server-move/**"]
          : []),
      ],
    }),
  },
});
