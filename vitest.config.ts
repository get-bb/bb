import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";

const workspaceRoots = [
  "apps",
  "packages",
  "tests",
  // Example plugins carry harness-based tests (@bb/plugin-sdk/testing).
  "examples/plugins",
] as const;

function discoverVitestProjects(): string[] {
  return workspaceRoots
    .flatMap((workspaceRoot) =>
      readdirSync(path.resolve(workspaceRoot), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(workspaceRoot, entry.name))
        .filter((projectPath) =>
          existsSync(path.resolve(projectPath, "vitest.config.ts")),
        ),
    )
    .sort((a, b) => a.localeCompare(b));
}

export default defineConfig({
  test: {
    silent: "passed-only",
    // Keep the default workspace test entrypoint aligned with every package/app
    // that defines its own Vitest config so new suites are not silently skipped.
    projects: discoverVitestProjects(),
  },
});
