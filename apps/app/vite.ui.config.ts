import { resolve } from "node:path";
import { defineConfig } from "vite";
import { sharedViteConfig } from "./vite.config";

// Build config for a user-editable UI source tree that lives OUTSIDE the repo
// (the "UI source" feature, seeded into <dataDir>/ui). The server invokes this
// from apps/app so the toolchain and node_modules resolve from the app
// workspace, while `root` points at the user's editable copy.
//
// - BB_UI_DIR: the UI source root (contains index.html, src/, public/, and a
//   node_modules symlink back into apps/app).
// - BB_UI_OUT: where to emit the build. Defaults to <BB_UI_DIR>/dist. The
//   server points this at a staging dir so a failed build never replaces the
//   live dist (build-gating).
const uiDir = process.env.BB_UI_DIR;
if (!uiDir) {
  throw new Error("BB_UI_DIR is required to build the UI source");
}
const outDir = process.env.BB_UI_OUT ?? resolve(uiDir, "dist");

export default defineConfig({
  ...sharedViteConfig,
  root: uiDir,
  resolve: {
    ...sharedViteConfig.resolve,
    alias: { "@": resolve(uiDir, "src") },
  },
  build: {
    ...sharedViteConfig.build,
    outDir,
    emptyOutDir: true,
  },
});
