import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    environment: "node",
    projects: sharedWorkerProjects({
      pkgDir: import.meta.dirname,
      name: "@bb/sealed-channel",
      include: ["test/**/*.test.ts"],
    }),
  },
});
