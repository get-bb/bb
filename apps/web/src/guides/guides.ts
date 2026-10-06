import { parseGuide, type Guide, type GuideSection } from "./parse-guide";

const files = import.meta.glob<string>("./pages/*/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

function locationFromPath(path: string): { section: string; slug: string } {
  const match = /\/pages\/([^/]+)\/([^/]+)\.md$/.exec(path);
  if (!match) {
    throw new Error(`Could not read guide section and slug from ${path}`);
  }
  return { section: match[1], slug: match[2] };
}

export const GUIDES: Guide[] = Object.entries(files).map(([path, source]) => {
  const { section, slug } = locationFromPath(path);
  return parseGuide(section, slug, source);
});

export function getGuide(
  section: GuideSection,
  slug: string,
): Guide | undefined {
  return GUIDES.find(
    (guide) => guide.section === section && guide.slug === slug,
  );
}
