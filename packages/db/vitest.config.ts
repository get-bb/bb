import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    testTimeout: 15_000,
    globalSetup: ["test/setup/migrated-db-template.ts"],
    projects: sharedWorkerProjects({
      pkgDir: __dirname,
      name: "@bb/db",
      include: ["test/**/*.test.ts"],
    }),
  },
});
