import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    projects: sharedWorkerProjects({
      pkgDir: __dirname,
      name: "@bb/connect",
      include: ["src/**/*.test.ts"],
    }),
  },
});
