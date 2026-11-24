import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";
import migration from "./oxlint.migration.json" with { type: "json" };
import policy from "./oxlint.policy.json" with { type: "json" };

export default defineConfig({
  extends: [core, react],
  ...policy,
  plugins: [...new Set([...core.plugins, ...react.plugins])],
  rules: { ...migration.rules, ...policy.rules },
});
