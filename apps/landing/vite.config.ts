import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Static marketing site: every route is prerendered to HTML at build time, so
// the dist/client output can be deployed to any static host.
export default defineConfig({
  cacheDir: "node_modules/.vite/landing",
  plugins: [
    tanstackStart({
      prerender: {
        enabled: true,
        crawlLinks: true,
        failOnError: true,
      },
    }),
    // react's vite plugin must come after start's vite plugin
    viteReact(),
  ],
  build: {
    reportCompressedSize: false,
  },
});
