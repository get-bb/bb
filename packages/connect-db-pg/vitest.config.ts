import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    testTimeout: 15_000,
    globalSetup: ["test/setup/connect-db-template.ts"],
    projects: sharedWorkerProjects({
      pkgDir: __dirname,
      name: "@bb/connect-db-pg",
      include: ["test/**/*.test.ts"],
    }),
  },
});
