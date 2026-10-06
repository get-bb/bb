import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    projects: sharedWorkerProjects({
      pkgDir: import.meta.dirname,
      name: "@bb/host-watcher",
      include: ["test/**/*.test.ts"],
    }),
  },
});
