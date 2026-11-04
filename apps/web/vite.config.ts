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
import { fetchGitHubStars } from "./src/server/github-stars.js";
import { resolveSiteOrigin } from "./src/server/site-origin.js";

export default defineConfig(async ({ command }) => {
  const cloudDev = resolveCloudDevViteSettings(command, process.env);
  const siteOrigin = resolveSiteOrigin(
    cloudDev?.vars.APP_URL ??
      unstable_readConfig({
        config: fileURLToPath(new URL("./wrangler.jsonc", import.meta.url)),
        env: process.env.CLOUDFLARE_ENV,
      }).vars.APP_URL,
  );
  const githubStars = await fetchGitHubStars({
    token: process.env.GITHUB_TOKEN,
  });
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
    define: {
      __SITE_ORIGIN__: JSON.stringify(siteOrigin),
      __GITHUB_STARS__: JSON.stringify(githubStars),
    },
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
      dedupe: ["react", "react-dom"],
    },
    server: {
      allowedHosts: [".localhost", ".ts.net"],
    },
    plugins: [
      cloudflare(cloudflareConfig),
      tailwindcss(),
      tanstackStart({
        server: { entry: "server-entry.ts" },
        router: {
          quoteStyle: "double",
          semicolons: true,
          routeTreeFileHeader: [
            "/* oxlint-disable */",
            "// @ts-nocheck",
            "// noinspection JSUnusedGlobalSymbols",
          ],
        },
      }),
      viteReact(),
    ],
  };
});
