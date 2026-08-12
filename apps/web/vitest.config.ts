import { defineWorkspaceTestConfig } from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  // vite.config.ts injects this from the target deployment's APP_URL; tests
  // load modules without that config, so they get an obviously-not-real origin.
  define: { __SITE_ORIGIN__: JSON.stringify("https://web.test") },
  test: {
    silent: "passed-only",
    name: "@bb/web",
    include: ["src/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
