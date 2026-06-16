import path from "path";
import { defineWorkspaceTestConfig } from "../../vitest.shared.js";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineWorkspaceTestConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    silent: "passed-only",
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["src/test/setup.ts"],
    testTimeout: 15_000,
  },
});
