import {
  defineWorkspaceTestConfig,
  findIsolationRequiringTests,
} from "../../vitest.shared.js";

const exclude = ["dist/**", "node_modules/**", "src/integration*.test.ts"];
const isolationTests = findIsolationRequiringTests(__dirname, ["src"]);

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    // Ten suites spawn the scripted echo bridge as a real child process (tsx
    // compiles it on every spawn), and some hold a request open for over a
    // second on purpose. On a slow CI runner the default 5s cap tipped over.
    // Both projects below extend this root, so the cap applies to each.
    testTimeout: 15_000,
    hookTimeout: 15_000,
    projects: [
      {
        extends: true,
        test: {
          name: "@bb/agent-runtime",
          include: ["src/**/*.test.ts"],
          exclude: [...exclude, ...isolationTests],
          isolate: false,
        },
      },
      {
        extends: true,
        test: {
          name: "@bb/agent-runtime:isolated",
          include: isolationTests,
          exclude,
        },
      },
    ],
  },
});
