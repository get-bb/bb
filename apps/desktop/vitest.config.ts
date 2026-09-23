import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    environment: "node",
    projects: sharedWorkerProjects({
      pkgDir: __dirname,
      name: "@bb/desktop",
      include: ["test/**/*.test.ts"],
      // bb-fork(windows): the desktop app ships for macOS/Linux; its bundle,
      // AppImage, and signing tests do not apply on Windows.
      exclude: [
        "dist/**",
        "node_modules/**",
        ...(process.platform === "win32"
          ? [
              "test/app-paths.test.ts",
              "test/bb-process.test.ts",
              "test/electron-builder-config.test.ts",
            ]
          : []),
      ],
    }),
  },
});
