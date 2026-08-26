import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    server: {
      deps: {
        // These files are final, self-contained ESM artifacts. Loading them
        // through Vite transforms the large provider bundles a second time
        // and does not match the daemon's native Node import.
        external: [/\.builtin-host-test-[^/]+\/dist\/host\.js/u],
      },
    },
    projects: sharedWorkerProjects({
      pkgDir: __dirname,
      name: "@bb/plugin-build",
      include: ["src/**/*.test.ts"],
    }),
  },
});
