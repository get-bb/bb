import { PLUGIN_CATALOG_CATEGORIES } from "../plugins/builtin-registry.js";

const categoryByTag = new Map(
  PLUGIN_CATALOG_CATEGORIES.map((category) => [
    category
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, ""),
    category,
  ]),
);

export function legacyMarketplaceCategory(
  tags: readonly string[],
  official: boolean,
): string {
  if (official) {
    for (const tag of tags) {
      const category = categoryByTag.get(tag);
      if (category !== undefined) return category;
    }
    return "Other";
  }
  const first = tags[0];
  return first === undefined
    ? "Other"
    : first
        .split("-")
        .filter((word) => word.length > 0)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}
