import { createRequire } from "node:module";
import path from "node:path";
import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

const srcDir = path.resolve(__dirname, "./src");
const interFontDir = path.dirname(
  createRequire(import.meta.url).resolve(
    "@fontsource-variable/inter/package.json",
  ),
);

export default defineWorkspaceTestConfig({
  define: { __SITE_ORIGIN__: JSON.stringify("https://web.test") },
  resolve: { alias: { "@": srcDir } },
  server: { fs: { allow: [interFontDir] } },
  test: {
    globalSetup: ["test/setup/connect-db-template.ts"],
    silent: "passed-only",
    projects: sharedWorkerProjects({
      pkgDir: __dirname,
      aliases: { "@": srcDir },
      name: "@bb/web",
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    }),
  },
});
