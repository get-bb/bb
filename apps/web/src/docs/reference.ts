import type { StructuredData } from "fumadocs-core/mdx-plugins/remark-structure";
import type { Source } from "fumadocs-core/source";

import { plainSurfaceCopy } from "../../../../plugins/plugin-api-docs/src/surface-copy";
import {
  SURFACE_GROUPS,
  type PluginSurface,
} from "../../../../plugins/plugin-api-docs/src/surfaces";

export const SPIKE_SURFACE_IDS = ["thread-panel"] as const;

export interface ReferencePageData {
  title: string;
  description: string;
  section: string;
  markdown: string;
  structuredData: StructuredData;
}

interface ReferenceSection {
  heading: string;
  id: string;
  paragraphs: string[];
}

function surfaceById(id: string): PluginSurface {
  const surface = SURFACE_GROUPS.flatMap((group) => group.surfaces).find(
    (candidate) => candidate.id === id,
  );
  if (!surface) {
    throw new Error(`Plugin surface ${id} is not in surfaces.ts`);
  }
  return surface;
}

function surfaceSections(surface: PluginSurface): ReferenceSection[] {
  const sections: ReferenceSection[] = [
    {
      heading: "What a plugin can do",
      id: "what-a-plugin-can-do",
      paragraphs: surface.bullets.map((bullet) => plainSurfaceCopy(bullet)),
    },
  ];
  if (surface.reference) {
    sections.push({
      heading: "Reference",
      id: "reference",
      paragraphs: surface.reference.map((entry) => plainSurfaceCopy(entry)),
    });
  }
  sections.push({
    heading: "SDK symbols",
    id: "sdk-symbols",
    paragraphs: surface.apiSymbols,
  });
  if (surface.firstParty) {
    sections.push({
      heading: "Used by",
      id: "used-by",
      paragraphs: surface.firstParty,
    });
  }
  return sections;
}

function sectionMarkdown(section: ReferenceSection): string {
  const items =
    section.id === "sdk-symbols"
      ? section.paragraphs.map((symbol) => `- \`${symbol}\``)
      : section.id === "reference"
        ? section.paragraphs
        : section.paragraphs.map((paragraph) => `- ${paragraph}`);
  return [`## ${section.heading}`, "", items.join("\n\n")].join("\n");
}

export function referencePageData(id: string): ReferencePageData {
  const surface = surfaceById(id);
  const summary = plainSurfaceCopy(surface.summary);
  const sections = surfaceSections(surface);
  const markdown = [
    "> Generated from `plugins/plugin-api-docs/src/surfaces.ts`, the Plugin Guide's own source. Spike sample.",
    "",
    summary,
    "",
    ...sections.map(sectionMarkdown),
  ].join("\n\n");
  return {
    title: surface.title,
    description: summary.replace(/\s*With this, a plugin can:$/u, ""),
    section: "Plugin surfaces",
    markdown,
    structuredData: {
      headings: sections.map((section) => ({
        id: section.id,
        content: section.heading,
      })),
      contents: [
        { heading: undefined, content: summary },
        ...sections.flatMap((section) =>
          section.paragraphs.map((content) => ({
            heading: section.id,
            content,
          })),
        ),
      ],
    },
  };
}

export const referenceSource: Source<{
  pageData: ReferencePageData;
  metaData: { title: string };
}> = {
  files: [
    {
      type: "meta",
      path: "plugin-surfaces/meta.json",
      data: { title: "Plugin surfaces" },
    },
    ...SPIKE_SURFACE_IDS.map((id) => ({
      type: "page" as const,
      path: `plugin-surfaces/${id}.md`,
      data: referencePageData(id),
    })),
  ],
};
