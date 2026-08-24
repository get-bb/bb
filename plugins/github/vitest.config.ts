import path from "node:path";
import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
  test: {
    silent: "passed-only",
    projects: sharedWorkerProjects({
      pkgDir: import.meta.dirname,
      aliases: { "@": path.resolve(import.meta.dirname, ".") },
      name: "bb-plugin-github",
      include: ["**/*.test.{ts,tsx}"],
      exclude: ["node_modules/**"],
    }),
  },
});
