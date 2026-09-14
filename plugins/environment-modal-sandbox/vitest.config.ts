import { fileURLToPath } from "node:url";
import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    projects: sharedWorkerProjects({
      pkgDir: fileURLToPath(new URL(".", import.meta.url)),
      name: "bb-plugin-environment-modal-sandbox",
      include: ["**/*.test.ts", "**/*.test.tsx"],
    }),
  },
});
