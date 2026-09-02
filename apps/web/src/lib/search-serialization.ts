import { defaultStringifySearch } from "@tanstack/react-router";

export function stringifySiteSearch(search: Record<string, unknown>): string {
  const rest = { ...search };
  const category = rest.category;
  delete rest.category;
  const params = new URLSearchParams(defaultStringifySearch(rest));
  const categories = Array.isArray(category) ? category : [category];
  for (const value of categories) {
    if (typeof value === "string") {
      params.append("category", value);
    }
  }
  const encoded = params.toString();
  return encoded.length === 0 ? "" : `?${encoded}`;
}
