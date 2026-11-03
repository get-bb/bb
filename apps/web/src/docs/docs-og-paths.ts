export const DOCS_OG_SIZE = { width: 1200, height: 630 } as const;

const DOCS_OG_BASE = "/docs/og";

export function docsOgImagePath(slugs: readonly string[]): string {
  const path = slugs.length === 0 ? ["index"] : slugs;
  return `${DOCS_OG_BASE}/${path.join("/")}.png`;
}

export function slugsFromOgPath(splat: string): string[] | null {
  if (!splat.endsWith(".png")) return null;
  const slugs = splat
    .replace(/\.png$/u, "")
    .split("/")
    .filter(Boolean);
  return slugs.length === 1 && slugs[0] === "index" ? [] : slugs;
}
