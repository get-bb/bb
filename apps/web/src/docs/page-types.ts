import { z } from "zod";

export const DOCS_PAGE_TYPES = [
  "tutorial",
  "how-to",
  "concept",
  "reference",
  "troubleshooting",
] as const;

export type DocsPageType = (typeof DOCS_PAGE_TYPES)[number];

interface DocsPageTemplate {
  requiredHeadings: readonly string[];
  lastHeading: string;
}

const DOCS_PAGE_TEMPLATES: Readonly<
  Record<DocsPageType, DocsPageTemplate>
> = {
  tutorial: {
    requiredHeadings: ["Next steps"],
    lastHeading: "Next steps",
  },
  "how-to": {
    requiredHeadings: ["Check it worked", "Related troubleshooting"],
    lastHeading: "Related troubleshooting",
  },
  concept: {
    requiredHeadings: ["Next steps"],
    lastHeading: "Next steps",
  },
  reference: {
    requiredHeadings: ["Where this list comes from"],
    lastHeading: "Where this list comes from",
  },
  troubleshooting: {
    requiredHeadings: ["What to send when you ask for help"],
    lastHeading: "What to send when you ask for help",
  },
};

const isoDate = z.iso.date();

export const docsFrontmatterFields = {
  description: z.string().min(1),
  type: z.enum(DOCS_PAGE_TYPES),
  sources: z.array(z.string().min(1)).min(1),
  since: z.union([
    z.literal("unreleased"),
    z.string().regex(/^\d+\.\d+\.\d+$/u),
  ]),
  owner: z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u),
  verified: z.union([
    isoDate,
    z.date().transform((date) => date.toISOString().slice(0, 10)),
  ]),
};

export function templateProblems(
  type: DocsPageType,
  headings: readonly string[],
): string[] {
  const template = DOCS_PAGE_TEMPLATES[type];
  const problems = template.requiredHeadings
    .filter((heading) => !headings.includes(heading))
    .map((heading) => `missing "## ${heading}"`);
  if (headings.at(-1) !== template.lastHeading) {
    problems.push(`must end with "## ${template.lastHeading}"`);
  }
  return problems;
}
