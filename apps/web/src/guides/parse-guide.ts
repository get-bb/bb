import { parseFrontMatter } from "../blog/parse-post";

export const GUIDE_SECTIONS = ["compare", "guides"] as const;

export type GuideSection = (typeof GUIDE_SECTIONS)[number];

export type Guide = {
  section: GuideSection;
  slug: string;
  path: string;
  title: string;
  description: string;
  body: string;
};

function isGuideSection(value: string): value is GuideSection {
  return GUIDE_SECTIONS.some((section) => section === value);
}

export function parseGuide(
  section: string,
  slug: string,
  source: string,
): Guide {
  if (!isGuideSection(section)) {
    throw new Error(`Guide ${slug} is in unknown section ${section}`);
  }
  const { fields, body } = parseFrontMatter(source);
  const { title, description } = fields;
  if (!title || !description) {
    throw new Error(`Guide ${slug} is missing title or description`);
  }
  return {
    section,
    slug,
    path: `/${section}/${slug}`,
    title,
    description,
    body,
  };
}

export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}
