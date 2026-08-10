import { defineConfig } from "vite";
import { loadViteDevConfig } from "@bb/config/vite-dev";
import { sharedViteConfig } from "./vite.config.js";

const viteDevConfig = loadViteDevConfig();
const devWebSocketBrowserHostPortDefine = JSON.stringify(
  viteDevConfig.serverWsOrigin.port,
);

export default defineConfig({
  ...sharedViteConfig,
  // Match the production CSS pipeline in dev. In particular, this lowers
  // Tailwind's nested conditional rules for Safari versions that parse
  // color-mix() but do not reliably apply nested @supports declarations.
  css: {
    transformer: "lightningcss",
  },
  define: {
    // Connect directly to the server in dev because Vite's WS proxy does not
    // handle upstream server restarts reliably.
    __BB_DEV_WS_BROWSER_HOST_PORT__: devWebSocketBrowserHostPortDefine,
    __BB_DEV_APP_BROWSER_HOST_PORT__: JSON.stringify(viteDevConfig.appPort),
  },
  server: {
    // Allow Tailscale MagicDNS names when Vite is behind Tailscale Serve.
    allowedHosts: [".ts.net"],
    host: viteDevConfig.appHost,
    port: viteDevConfig.appPort,
    proxy: {
      "/api": {
        target: viteDevConfig.serverHttpOrigin,
        changeOrigin: true,
        xfwd: true,
      },
      "/ws": {
        target: viteDevConfig.serverHttpOrigin,
        changeOrigin: true,
        ws: true,
        xfwd: true,
      },
    },
  },
});
