import path from "node:path";
import { docsContent } from "./scripts/docs-content.js";
import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

const srcDir = path.resolve(__dirname, "./src");

export default defineWorkspaceTestConfig({
  root: __dirname,
  plugins: [docsContent()],
  define: { __SITE_ORIGIN__: JSON.stringify("https://web.test") },
  resolve: { alias: { "@": srcDir } },
  test: {
    silent: "passed-only",
    projects: sharedWorkerProjects({
      pkgDir: __dirname,
      aliases: { "@": srcDir },
      name: "@bb/web",
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    }),
  },
});
