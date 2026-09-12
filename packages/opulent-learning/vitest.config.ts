import { defineWorkspaceTestConfig, sharedWorkerProjects } from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    projects: sharedWorkerProjects({
      pkgDir: import.meta.dirname,
      name: "@opulent/learning-contracts",
      include: ["src/**/*.test.ts"],
    }),
  },
});
