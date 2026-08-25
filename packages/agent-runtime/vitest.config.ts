import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    // Ten suites spawn the scripted echo bridge as a real child process. The
    // Turbo test task prebuilds its worker and bridge artifact once, while
    // some lifecycle cases still hold a request open for over a second on
    // purpose. Both projects below extend this root.
    testTimeout: 15_000,
    hookTimeout: 15_000,
    projects: sharedWorkerProjects({
      pkgDir: __dirname,
      name: "@bb/agent-runtime",
      include: ["src/**/*.test.ts"],
      exclude: ["dist/**", "node_modules/**", "src/integration*.test.ts"],
    }),
  },
});
