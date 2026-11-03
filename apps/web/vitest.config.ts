import path from "node:path";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

const srcDir = path.resolve(__dirname, "./src");

export default defineWorkspaceTestConfig({
  define: { __SITE_ORIGIN__: JSON.stringify("https://web.test") },
  plugins: [fumadocsMdx({ macro: { include: "src/docs/content.ts" } })],
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
