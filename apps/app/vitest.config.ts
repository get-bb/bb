import path from "path";
import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
  SharedWorkerSequencer,
} from "../../vitest.shared.js";
import type { TestSpecification } from "vitest/node";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { forkablePluginPaths } from "./vite-forkable-plugin-paths.js";
import { sharedUiEnvSeam } from "./vite-shared-ui-seam.js";

class AppTestSequencer extends SharedWorkerSequencer {
  override async sort(
    files: TestSpecification[],
  ): Promise<TestSpecification[]> {
    const sorted = await super.sort(files);
    return sorted.sort(
      (a, b) =>
        Number(a.project.config.isolate) - Number(b.project.config.isolate),
    );
  }
}

export default defineWorkspaceTestConfig({
  plugins: [
    forkablePluginPaths(path.resolve(__dirname, "./src")),
    sharedUiEnvSeam(),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    silent: "passed-only",
    sequence: { sequencer: AppTestSequencer },
    environment: "node",
    setupFiles: ["src/test/setup.ts"],
    testTimeout: 15_000,
    projects: sharedWorkerProjects({
      pkgDir: __dirname,
      aliases: { "@": path.resolve(__dirname, "./src") },
      name: "@bb/app",
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
      exclude: [
        "dist/**",
        "node_modules/**",
        ...(process.env.BB_SIDEBAR_BENCH === "1"
          ? []
          : ["src/components/sidebar/sidebar.bench.test.tsx"]),
      ],
    }),
  },
});
