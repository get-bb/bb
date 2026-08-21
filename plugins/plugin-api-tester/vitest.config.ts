import { defineWorkspaceTestConfig } from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    name: "bb-plugin-plugin-api-tester",
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**"],
  },
});
