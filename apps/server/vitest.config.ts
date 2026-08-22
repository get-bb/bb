import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    env: {
      BB_DATA_DIR: "/tmp/bb-server-test",
      BB_SERVER_PORT: "49161",
      BB_HOST_DAEMON_PORT: "49162",
    },
    projects: sharedWorkerProjects({
      pkgDir: __dirname,
      name: "@bb/server",
      include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    }),
  },
});
