import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  resolve: {
    alias: {
      // tippy.js (via @tiptap/extension-bubble-menu) only ships a CJS main;
      // point vitest at the ESM build so `import tippy` gets the function.
      "tippy.js": "tippy.js/dist/tippy.esm.js",
    },
  },
  test: {
    silent: "passed-only",
    // CI runners are slow enough that testing-library's default 1s findBy*/
    // waitFor timeout flakes on the heavier UI suites (pager, manage, rail).
    testTimeout: 20_000,
    setupFiles: ["./vitest.setup.ts"],
    server: {
      deps: {
        // Inlined so the tippy.js alias above applies to its import; left
        // external it runs under Node ESM, where tippy's CJS main resolves
        // to a namespace object instead of the function.
        inline: ["@tiptap/extension-bubble-menu"],
      },
    },
    projects: sharedWorkerProjects({
      pkgDir: __dirname,
      name: "bb-plugin-tasks",
      include: ["**/*.test.{ts,tsx}"],
      exclude: ["node_modules/**"],
    }),
  },
});
