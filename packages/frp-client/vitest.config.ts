import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    environment: "node",
    projects: sharedWorkerProjects({
      pkgDir: __dirname,
      name: "@bb/frp-client",
      include: ["test/**/*.test.ts"],
    }),
  },
});
