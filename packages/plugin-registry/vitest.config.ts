import { defineWorkspaceTestConfig } from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // The vendor-all fixture runs a real esbuild + Tailwind build.
    testTimeout: 120_000,
  },
});
