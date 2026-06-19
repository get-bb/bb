import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import babel from "@rolldown/plugin-babel";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { DOWNLOAD_MACOS_REDIRECT_PATH } from "./src/site";

type PrerenderPage = {
  path: string;
};

function shouldPrerenderPage(page: PrerenderPage): boolean {
  return !page.path.startsWith(DOWNLOAD_MACOS_REDIRECT_PATH);
}

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
        filter: shouldPrerenderPage,
      },
    }),
    // react's vite plugin must come after start's vite plugin
    viteReact(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
  build: {
    reportCompressedSize: false,
  },
});
