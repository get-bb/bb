import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    environment: "node",
    testTimeout: 15_000,
    projects: sharedWorkerProjects({
      pkgDir: __dirname,
      name: "bb-plugin-workflows",
      include: ["src/**/*.test.{ts,tsx}"],
    }),
  },
});
