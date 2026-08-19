import { fileURLToPath } from "node:url";
import { defineWorkspaceTestConfig } from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  resolve: {
    alias: {
      // app.tsx reaches its own modules through the tsconfig "@/*" path.
      // Esbuild reads that from tsconfig.json when bundling the plugin;
      // vitest needs it spelled out, or importing app.tsx fails to resolve.
      "@/": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    silent: "passed-only",
    name: "bb-plugin-github",
    // The jsdom panel suite renders the whole table; CPU-heavy UI tests get
    // the same budget as the main app suite.
    testTimeout: 15_000,
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**"],
  },
});
