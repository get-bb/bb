import { createRequire } from "node:module";
import { defineConfig } from "vite";
import { sharedViteConfig } from "./vite.config.js";

const require = createRequire(import.meta.url);

export default defineConfig({
  ...sharedViteConfig,
  plugins: sharedViteConfig.plugins.filter(
    (plugin) => !("name" in plugin) || plugin.name !== "bb:bundle-stats",
  ),
  cacheDir: "node_modules/.vite/app-profiling",
  build: {
    ...sharedViteConfig.build,
    outDir: "dist-profiling",
    emptyOutDir: true,
    minify: false,
  },
  resolve: {
    ...sharedViteConfig.resolve,
    alias: [
      {
        find: /^react-dom\/client$/u,
        replacement: require.resolve("react-dom/profiling"),
      },
      ...Object.entries(sharedViteConfig.resolve.alias).map(
        ([find, replacement]) => ({ find, replacement }),
      ),
    ],
  },
});
