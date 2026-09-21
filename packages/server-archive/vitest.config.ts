import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    testTimeout: 30_000,
    projects: sharedWorkerProjects({
      pkgDir: __dirname,
      name: "@bb/server-archive",
      include: ["test/**/*.test.ts"],
    }),
  },
});
