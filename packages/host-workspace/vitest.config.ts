import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    // bb-fork(windows): clone/push/fetch tests need more than the CI budget.
    testTimeout: 30_000,
    // bb-fork(windows): force Git's default rename detection for the suite.
    setupFiles: ["./test/fork-test-setup.ts"],
    projects: sharedWorkerProjects({
      pkgDir: __dirname,
      name: "@bb/host-workspace",
      include: ["test/**/*.test.ts"],
    }),
  },
});
