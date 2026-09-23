import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    testTimeout: 20_000,
    projects: sharedWorkerProjects({
      pkgDir: __dirname,
      name: "bb-plugin-theme-preview",
      include: ["**/*.test.{ts,tsx}"],
      exclude: ["node_modules/**"],
    }),
  },
});
