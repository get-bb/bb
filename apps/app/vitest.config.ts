import path from "path";
import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { sharedUiEnvSeam } from "./vite-shared-ui-seam.js";

export default defineWorkspaceTestConfig({
  plugins: [sharedUiEnvSeam(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    silent: "passed-only",
    environment: "node",
    setupFiles: ["src/test/setup.ts"],
    testTimeout: 15_000,
    // Per-file module-graph import and setup were ~85% of this suite's CPU.
    // Node-environment files that do not mock share a worker context; jsdom
    // files keep their own worker (see vitest.shared.ts).
    projects: sharedWorkerProjects({
      pkgDir: __dirname,
      aliases: { "@": path.resolve(__dirname, "./src") },
      name: "@bb/app",
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    }),
  },
});
