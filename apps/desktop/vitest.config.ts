import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    environment: "node",
    projects: sharedWorkerProjects({
      pkgDir: __dirname,
      name: "@bb/desktop",
      include: ["test/**/*.test.ts"],
    }),
  },
});
