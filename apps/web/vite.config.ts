import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const cloudDevStatePath = process.env.BB_CLOUD_DEV_STATE_PATH?.trim();
const cloudDevAppUrl = process.env.BB_CLOUD_DEV_APP_URL?.trim();
const cloudDevServerUrlTemplate =
  process.env.BB_CLOUD_DEV_SERVER_URL_TEMPLATE?.trim();
const cloudDevBaseDomain = cloudDevAppUrl
  ? new URL(cloudDevAppUrl).hostname
  : undefined;

const cloudDevConfig =
  cloudDevStatePath &&
  cloudDevAppUrl &&
  cloudDevServerUrlTemplate &&
  cloudDevBaseDomain
    ? {
        persistState: { path: cloudDevStatePath },
        config: (config: { vars?: Record<string, unknown> }) => ({
          vars: {
            ...config.vars,
            APP_URL: cloudDevAppUrl,
            BASE_DOMAIN: cloudDevBaseDomain,
            BETTER_AUTH_SECRET:
              "6c9e2f41a7d58b30c4e918f267bd5a0c3f1468e2d9a57b04c8f31a6d72e95b40",
            CONNECT_SERVER_URL_TEMPLATE: cloudDevServerUrlTemplate,
            DEV_EMAIL_PASSWORD_AUTH: "true",
            GITHUB_CLIENT_ID: "local-cloud-dev-unused",
            GITHUB_CLIENT_SECRET: "local-cloud-dev-unused",
          },
        }),
      }
    : {};

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // Dev binds all interfaces so the server is reachable over the tailnet
  // (see the dev script's --host 0.0.0.0); allow Tailscale MagicDNS names.
  server: {
    allowedHosts: [".localhost", ".ts.net"],
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" }, ...cloudDevConfig }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
});
