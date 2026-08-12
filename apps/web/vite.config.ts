import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import {
  cloudflare,
  type PluginConfig,
  type WorkerConfig,
} from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { unstable_readConfig } from "wrangler";
import { resolveCloudDevViteSettings } from "./src/server/cloud-dev-vite.js";
import { resolveSiteOrigin } from "./src/server/site-origin.js";

export default defineConfig(({ command }) => {
  const cloudDev = resolveCloudDevViteSettings(command, process.env);
  // Read APP_URL back out of the wrangler env this build targets (wrangler's
  // own reader handles the JSONC and the production env's inheritance), so the
  // unfurl tags advertise the deployment they actually ship to. Cloud dev
  // overrides it with the tunnel URL, same as every other var.
  const siteOrigin = resolveSiteOrigin(
    cloudDev?.vars.APP_URL ??
      unstable_readConfig({
        config: fileURLToPath(new URL("./wrangler.jsonc", import.meta.url)),
        env: process.env.CLOUDFLARE_ENV,
      }).vars.APP_URL,
  );
  const cloudflareConfig: PluginConfig = {
    viteEnvironment: { name: "ssr" },
    ...(cloudDev
      ? {
          persistState: { path: cloudDev.persistStatePath },
          config: (config: WorkerConfig) => ({
            vars: {
              ...config.vars,
              ...cloudDev.vars,
            },
          }),
        }
      : {}),
  };

  return {
    define: { __SITE_ORIGIN__: JSON.stringify(siteOrigin) },
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    // Dev binds all interfaces so the server is reachable over the tailnet
    // (see the dev script's --host 0.0.0.0); allow Tailscale MagicDNS names.
    server: {
      allowedHosts: [".localhost", ".ts.net"],
    },
    plugins: [
      cloudflare(cloudflareConfig),
      tailwindcss(),
      tanstackStart(),
      viteReact(),
    ],
  };
});
