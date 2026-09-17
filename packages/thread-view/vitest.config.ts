import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    projects: [
      ...sharedWorkerProjects({
        pkgDir: __dirname,
        name: "@bb/thread-view",
        include: ["test/**/*.test.ts"],
        exclude: [
          "dist/**",
          "node_modules/**",
          "test/timeline-materialization.test.ts",
        ],
      }),
      {
        extends: true,
        test: {
          name: "@bb/thread-view:materialization",
          include: ["test/timeline-materialization.test.ts"],
          isolate: true,
        },
      },
    ],
  },
});
