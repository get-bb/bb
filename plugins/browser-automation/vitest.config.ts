import { fileURLToPath } from "node:url";
import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";
export default defineWorkspaceTestConfig({
  test: {
    projects: sharedWorkerProjects({
      pkgDir: fileURLToPath(new URL(".", import.meta.url)),
      name: "bb-plugin-browser-automation",
      include: ["**/*.test.ts"],
      exclude: ["dist/**", "node_modules/**"],
    }),
  },
});
