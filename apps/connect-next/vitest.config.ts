import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    testTimeout: 60_000,
    hookTimeout: 120_000,
    projects: sharedWorkerProjects({
      pkgDir: __dirname,
      name: "@bb/connect-next",
      include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    }),
  },
});
