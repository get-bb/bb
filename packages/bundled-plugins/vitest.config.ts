import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    projects: sharedWorkerProjects({
      pkgDir: __dirname,
      name: "@bb/bundled-plugins",
      include: ["src/**/*.test.ts"],
    }),
  },
});
