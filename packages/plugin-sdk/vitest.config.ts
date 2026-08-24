import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    projects: sharedWorkerProjects({
      pkgDir: __dirname,
      name: "@get-bb/plugin-sdk",
      include: [
        "src/**/*.test.ts",
        "src/**/*.test.tsx",
        // Build/release scripts are plain .mjs and live outside src.
        "scripts/**/*.test.mjs",
      ],
    }),
  },
});
