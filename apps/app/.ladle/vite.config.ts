import path from "path";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { resolveCurrentDevInstanceConfig } from "@bb/config/runtime";
import { sharedUiEnvSeam } from "../vite-shared-ui-seam.js";

const repoRoot = path.resolve(__dirname, "../../..");
const devInstance = resolveCurrentDevInstanceConfig(repoRoot);
// Plugin RPCs accept only origins belonging to this checkout's app. Ladle is
// the local review proxy for that same app, including when viewed through a
// bb connect share, so present its upstream requests as the dev app origin.
const trustedDevAppHeaders = {
  origin: `http://localhost:${devInstance.ports.appPort}`,
};

// Ladle bundles Vite 6 (rollup) and provides its own React plugin via
// @vitejs/plugin-react-swc. The app's main vite.config.ts uses
// @vitejs/plugin-react@6, which only works inside rolldown-vite — loading it
// here crashes Ladle's transform pipeline with "Missing field `moduleType`".
export default defineConfig({
  plugins: [sharedUiEnvSeam(), tailwindcss()],
  // Keep app and Ladle dep optimization metadata from clobbering each other.
  cacheDir: "node_modules/.vite/ladle",
  worker: {
    format: "es",
  },
  resolve: {
    conditions: ["source"],
    // Stories can live in linked workspace packages outside apps/app. Always
    // resolve their React imports through Ladle's copy so the renderer and
    // story hooks cannot end up on different module instances after Vite's
    // dependency optimizer refreshes.
    dedupe: ["react", "react-dom"],
    alias: {
      "@": path.resolve(__dirname, "../src"),
    },
  },
  // React 19's prebundled jsx-dev-runtime collapses to the production module
  // (which sets `jsxDEV = void 0`) when esbuild optimizes it as
  // NODE_ENV=production. Force a development define during dep optimization
  // so the dev runtime keeps the real `jsxDEV` export that Ladle's SWC
  // transform emits calls to.
  optimizeDeps: {
    esbuildOptions: {
      define: {
        "process.env.NODE_ENV": '"development"',
      },
    },
  },
  // Live page stories exercise the same queries, plugin bundles, and
  // mutations as the app. Proxy them to this checkout's isolated dev server
  // instead of reconstructing server state with Ladle-only fixtures.
  server: {
    // bb Connect shares use authenticated `<machine>--<port>.getbb.app` hosts.
    allowedHosts: [".getbb.app"],
    proxy: {
      "/api": {
        target: devInstance.serverUrl,
        changeOrigin: true,
        headers: trustedDevAppHeaders,
      },
      "/ws": {
        target: devInstance.serverUrl,
        changeOrigin: true,
        ws: true,
        headers: trustedDevAppHeaders,
      },
    },
  },
});
