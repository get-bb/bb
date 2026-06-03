import { defineConfig } from "vitest/config";
import { workspaceTestAliases } from "../../vitest.workspace-aliases.js";

export default defineConfig({
  test: {
    alias: workspaceTestAliases,
    environment: "node",
    include: ["test/**/*.test.ts"],
    name: "@bb/sdk",
  },
});
