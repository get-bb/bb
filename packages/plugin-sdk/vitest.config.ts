import { defineWorkspaceTestConfig } from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    name: "@get-bb/plugin-sdk",
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      // Build/release scripts are plain .mjs and live outside src.
      "scripts/**/*.test.mjs",
    ],
    exclude: ["dist/**", "node_modules/**"],
  },
});
