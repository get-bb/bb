import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type UserConfig } from "vite";
import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { bundleStats } from "./vite-bundle-stats.js";
import { fontPreload } from "./vite-font-preload.js";
import { sharedUiEnvSeam } from "./vite-shared-ui-seam.js";

const appDir = dirname(fileURLToPath(import.meta.url));

export const sharedViteConfig = {
  plugins: [
    sharedUiEnvSeam(),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
    // Build-only: writes bundle-stats.json for the boot-payload budget check.
    bundleStats(),
    // Build-only: <link rel="preload"> for the Inter latin woff2.
    fontPreload(),
  ],
  // Keep app and Ladle dep optimization metadata from clobbering each other.
  cacheDir: "node_modules/.vite/app",
  build: {
    // Skip compressed-size calculation to keep production app builds fast.
    reportCompressedSize: false,
    // The desktop-app icons (WorkspaceOpenTargetIcon) are each under Vite's
    // 4 KB inline limit, so by default they are base64-inlined into the
    // thread route chunk: ~35 KB brotli that every phone downloads for a
    // menu that needs a local host daemon on 127.0.0.1. Keep them as files
    // and let the browser fetch only the ones a menu actually renders.
    assetsInlineLimit: (filePath) =>
      filePath.includes("/workspace-open-target-icons/") ? false : undefined,
    rolldownOptions: {
      output: {
        // Merge the boot payload's micro-chunks. Rolldown's automatic
        // splitting left half the boot-path requests carrying ~2% of the
        // bytes (sub-4 KB shared chunks, many below the 1 KiB precompress
        // floor), and on the relayed mobile path every request is a full
        // worker → DO → tunnel → laptop round trip. The `$initial` tag
        // captures exactly the entry's static-import closure, so lazy-route
        // and on-demand facades (and the budget's closure walk and
        // forbidden-package gates over them) are untouched. Two groups so a
        // release that only touches app code leaves the vendor chunk's hash
        // — the bulk of the boot bytes — cacheable across updates.
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
          ],
        },
      },
    },
  },
  optimizeDeps: {
    // The terminal imports xterm lazily when the panel mounts. Pre-optimize
    // these packages so opening the terminal does not discover new deps and
    // invalidate Vite's optimized-dependency hash mid-session.
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
