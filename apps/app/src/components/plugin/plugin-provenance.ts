import type { PluginProvenance } from "@/hooks/queries/plugin-settings-queries";

/**
 * Single source of truth for "BB Official": the Type filter, the installed-list
 * sort grouping, and the row's "BB Official" badge must all agree, or a user
 * filtering to User sees rows badged BB Official.
 */
export function isOfficialProvenance(provenance: PluginProvenance): boolean {
  return provenance === "builtin" || provenance === "catalog";
}
