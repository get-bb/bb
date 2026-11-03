import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { bundleStats } from "./vite-bundle-stats.js";
import { splitPrefetch } from "./vite-split-prefetch.js";
import { routeModulePreload } from "./vite-route-modulepreload.js";
import { fontPreload } from "./vite-font-preload.js";
import { sharedUiEnvSeam } from "./vite-shared-ui-seam.js";
import { cachedReactCompiler } from "./vite-react-compiler.js";
import { journeyChunkGroups } from "./vite-journey-chunks.js";
import { pluginZodRuntime } from "./vite-plugin-zod-runtime.js";

const appDir = dirname(fileURLToPath(import.meta.url));

export const sharedViteConfig = {
  plugins: [
    pluginZodRuntime(),
    sharedUiEnvSeam(),
    react(),
    cachedReactCompiler(),
    tailwindcss(),
    bundleStats(),
    fontPreload(),
    routeModulePreload("src/views/SplitWorkspaceRoute.tsx"),
    splitPrefetch({
      "markdown-html": "src/components/ui/markdown-html.tsx",
      "queued-messages-list":
        "src/components/promptbox/banner/QueuedMessagesList.tsx",
    }),
  ],
  cacheDir: "node_modules/.vite/app",
  build: {
    reportCompressedSize: false,
    assetsInlineLimit: (filePath) =>
      filePath.includes("/workspace-open-target-icons/") ? false : undefined,
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [
            {
              name: "boot-vendor",
              test: /node_modules/,
              tags: ["$initial"],
              priority: 2,
              minSize: 12 * 1024,
            },
            {
              name: "boot-app",
              tags: ["$initial"],
              priority: 1,
              minSize: 12 * 1024,
            },
            ...journeyChunkGroups(appDir, [
              {
                name: "workspace-route",
                entries: ["src/views/SplitWorkspaceRoute.tsx"],
              },
              {
                name: "plugin-frontend",
                entries: ["src/lib/plugin-frontend.ts"],
              },
              {
                name: "thread-and-compose",
                entries: [
                  "src/views/thread-detail/ThreadDetailView.tsx",
                  "src/views/RootComposeView.tsx",
                ],
              },
              {
                name: "thread-detail",
                entries: ["src/views/thread-detail/ThreadDetailView.tsx"],
              },
              {
                name: "root-compose",
                entries: ["src/views/RootComposeView.tsx"],
              },
            ]),
          ],
        },
      },
    },
  },
  optimizeDeps: {
    include: ["@xterm/addon-fit", "@xterm/addon-web-links", "@xterm/xterm"],
  },
  resolve: {
    conditions: ["source"],
    alias: {
      "@": resolve(appDir, "./src"),
    },
  },
} satisfies UserConfig;

export default defineConfig(sharedViteConfig);
