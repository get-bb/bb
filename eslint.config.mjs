import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

const noBlockingChildProcessRules = {
  "no-restricted-imports": [
    "error",
    {
      paths: [
        {
          name: "node:child_process",
          importNames: ["spawnSync", "execSync", "execFileSync"],
          message:
            "Use async child_process APIs instead of blocking sync variants.",
        },
        {
          name: "child_process",
          importNames: ["spawnSync", "execSync", "execFileSync"],
          message:
            "Use async child_process APIs instead of blocking sync variants.",
        },
      ],
    },
  ],
  "no-restricted-syntax": [
    "error",
    {
      selector:
        "CallExpression[callee.name='spawnSync'], CallExpression[callee.name='execSync'], CallExpression[callee.name='execFileSync']",
      message:
        "Use async child_process APIs instead of blocking sync variants.",
    },
  ],
};

// The server must not access workspace filesystems directly — all workspace
// interaction goes through daemon commands. This rule enforces the boundary so
// it holds when the daemon runs on a remote host.
const serverNoWorkspaceAccessRules = {
  "no-restricted-imports": [
    "error",
    {
      paths: [
        {
          name: "@bb/host-workspace",
          message:
            "Server must not access workspaces directly. Use daemon commands instead.",
        },
        {
          name: "@bb/host-watcher",
          message:
            "Server must not access host watchers directly. Use daemon commands instead.",
        },
        {
          name: "node:fs",
          message:
            "Server must not use node:fs. Use daemon commands for workspace access. (attachments.ts is the only exception — it manages server-local storage.)",
        },
        {
          name: "node:fs/promises",
          message:
            "Server must not use node:fs/promises. Use daemon commands for workspace access. (attachments.ts is the only exception — it manages server-local storage.)",
        },
      ],
    },
  ],
};

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/routeTree.gen.ts",
      "packages/core/src/generated/**",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.flat["recommended-latest"].rules,
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      // Existing app code has compiler-adoption findings in these categories.
      // Keep them visible in CI without blocking this React Compiler rollout.
      "react-hooks/immutability": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    files: ["apps/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}"],
    ignores: [
      "**/__tests__/**",
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/scripts/**",
      "packages/core/src/generated/**",
    ],
    rules: noBlockingChildProcessRules,
  },
  {
    files: ["apps/server/src/**/*.ts"],
    ignores: ["**/*.test.ts", "**/__tests__/**"],
    rules: serverNoWorkspaceAccessRules,
  },
];
