import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    silent: "passed-only",
    testTimeout: 25_000,
    name: "bb-plugin-github",
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**"],
  },
});
const workspaceConfigUrl = new URL("../../vitest.shared.ts", import.meta.url);

export default existsSync(workspaceConfigUrl)
  ? await (async () => {
      const { defineWorkspaceTestConfig, sharedWorkerProjects } = await import(
        workspaceConfigUrl.href
      );
      return defineWorkspaceTestConfig({
        ...config,
        test: {
          testTimeout: 25_000,
          projects: sharedWorkerProjects({
            pkgDir: fileURLToPath(new URL(".", import.meta.url)),
            name: "bb-plugin-github",
            include: ["**/*.test.{ts,tsx}"],
          }),
        },
      });
    })()
  : config;
