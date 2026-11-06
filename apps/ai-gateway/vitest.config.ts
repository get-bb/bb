import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    globalSetup: ["test/setup/connect-db-template.ts"],
    silent: "passed-only",
    projects: sharedWorkerProjects({
      pkgDir: __dirname,
      name: "@bb/ai-gateway",
      include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    }),
  },
});
