import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    globalSetup: ["test/setup/connect-db-template.ts"],
    projects: sharedWorkerProjects({
      pkgDir: __dirname,
      name: "@bb/connect",
      include: ["src/**/*.test.ts"],
    }),
  },
});
