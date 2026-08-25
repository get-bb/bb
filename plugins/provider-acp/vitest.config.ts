import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    projects: sharedWorkerProjects({
      pkgDir: __dirname,
      name: "bb-plugin-provider-acp",
      include: ["*.test.ts", "src/**/*.test.ts"],
    }),
  },
});
