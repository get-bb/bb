import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // The vendor-all fixture runs a real esbuild + Tailwind build.
    testTimeout: 120_000,
  },
});
