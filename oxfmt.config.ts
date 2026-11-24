import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";
import policy from "./oxfmt.policy.json" with { type: "json" };

export default defineConfig({
  ...ultracite,
  ...policy,
  trailingComma: "all",
  proseWrap: "preserve",
  sortImports: false,
  sortTailwindcss: false,
});
