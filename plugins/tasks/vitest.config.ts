import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      "tippy.js": "tippy.js/dist/tippy.esm.js",
    },
  },
  test: {
    silent: "passed-only",
    name: "bb-plugin-tasks",
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**"],
    testTimeout: 20_000,
    setupFiles: ["./vitest.setup.ts"],
    server: {
      deps: {
        inline: ["@tiptap/extension-bubble-menu"],
      },
    },
  },
});
