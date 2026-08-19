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
