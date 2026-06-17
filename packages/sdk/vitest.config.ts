import { defineWorkspaceTestConfig } from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    name: "@bb/sdk",
  },
});
