import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    environment: "node",
    projects: sharedWorkerProjects({
      pkgDir: __dirname,
      name: "@bb/client-core",
      include: ["test/**/*.test.ts"],
    }),
  },
});
