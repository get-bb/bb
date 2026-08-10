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
import { resolveCloudDevViteSettings } from "./src/server/cloud-dev-vite.js";

export default defineConfig(({ command }) => {
  const cloudDev = resolveCloudDevViteSettings(command, process.env);
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
