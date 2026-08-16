import { defineWorkspaceTestConfig } from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    name: "bb-plugin-keep-awake",
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
