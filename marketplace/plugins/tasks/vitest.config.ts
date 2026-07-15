import path from "node:path";
import { defineWorkspaceTestConfig } from "../../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
      // tippy.js (via @tiptap/extension-bubble-menu) only ships a CJS main;
      // point vitest at the ESM build so `import tippy` gets the function.
      "tippy.js": "tippy.js/dist/tippy.esm.js",
    },
  },
  test: {
    silent: "passed-only",
    name: "bb-plugin-tasks",
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**"],
    server: {
      deps: {
        // Inlined so the tippy.js alias above applies to its import; left
        // external it runs under Node ESM, where tippy's CJS main resolves
        // to a namespace object instead of the function.
        inline: ["@tiptap/extension-bubble-menu"],
      },
    },
  },
});
