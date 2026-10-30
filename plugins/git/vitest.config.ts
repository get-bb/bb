import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  resolve: { tsconfigPaths: true },
  test: {
    silent: "passed-only",
    testTimeout: 15_000,
    projects: sharedWorkerProjects({
      pkgDir: __dirname,
      name: "bb-plugin-bb--git",
      include: ["**/*.test.{ts,tsx}"],
    }),
  },
});
