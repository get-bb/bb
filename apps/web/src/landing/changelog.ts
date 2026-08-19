/* Parses the repo-root CHANGELOG.md (the single source of truth for release
 * notes) into structured releases for the /changelog page. The changelog's
 * shape is deliberately simple — `## <version>` per release, optional intro
 * paragraphs, `### <section>` groups of paragraphs and `- ` bullets — and the
 * parser supports exactly that shape. */

export type ReleaseBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] };

export type ReleaseSection = {
  title: string;
  blocks: ReleaseBlock[];
};

export type Release = {
  version: string;
  /** Intro blocks between the `##` heading and the first `###` section. */
  lede: ReleaseBlock[];
  sections: ReleaseSection[];
};

/** Presentation extras that don't belong in CHANGELOG.md itself. */
export type ReleaseMeta = {
  /** Human-readable ship date, e.g. "July 14, 2026". */
  date: string;
  /** Marketing headline shown instead of the bare version number. */
  headline: string;
};

export const RELEASE_META: Record<string, ReleaseMeta> = {
  "0.39.0": {
    date: "August 19, 2026",
    headline: "Faster large threads and a long list of fixes",
  },
  "0.38.0": {
    date: "August 15, 2026",
    headline: "Extensions Page and Plugin Marketplaces",
  },
  "0.37.0": {
    date: "August 11, 2026",
    headline: "A much faster mobile app",
  },
  "0.36.0": {
    date: "August 8, 2026",
    headline: "Fixes and improvements",
  },
  "0.35.0": {
    date: "August 4, 2026",
    headline: "Plugins",
  },
  "0.34.0": {
    date: "July 28, 2026",
    headline: "Fresher models, cross-provider questions",
  },
  "0.33.0": {
    date: "July 21, 2026",
    headline: "Quieter updates and safer approvals",
  },
  "0.0.31": {
    date: "July 17, 2026",
    headline: "Splits for everyone",
  },
  "0.0.30": {
    date: "July 14, 2026",
    headline: "Multi-machine workflows and bb Connect",
  },
  "0.0.29": {
    date: "July 9, 2026",
    headline: "More agents, more models, redesigned Settings",
  },
};

export function parseChangelog(markdown: string): Release[] {
  const releases: Release[] = [];
  let release: Release | null = null;
  let section: ReleaseSection | null = null;
  let paragraph: string[] = [];

  const blocksInScope = (): ReleaseBlock[] | null => {
    if (!release) {
      return null;
    }
    return section ? section.blocks : release.lede;
  };

  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }
    const text = paragraph.join(" ").trim();
    paragraph = [];
    const blocks = blocksInScope();
    if (text && blocks) {
      blocks.push({ kind: "paragraph", text });
    }
  };

  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trimEnd();

    if (line.startsWith("## ") && !line.startsWith("### ")) {
      flushParagraph();
      section = null;
      release = { version: line.slice(3).trim(), lede: [], sections: [] };
      releases.push(release);
      continue;
    }
    if (!release) {
      // Preamble (the `# Changelog` title) — nothing to collect.
      continue;
    }
    if (line.startsWith("### ")) {
      flushParagraph();
      section = { title: line.slice(4).trim(), blocks: [] };
      release.sections.push(section);
      continue;
    }
    if (line.startsWith("- ")) {
      flushParagraph();
      const blocks = blocksInScope();
      if (!blocks) {
        continue;
      }
      const last = blocks.at(-1);
      let list = last?.kind === "list" ? last : null;
      if (!list) {
        list = { kind: "list", items: [] };
        blocks.push(list);
      }
      list.items.push(line.slice(2).trim());
      continue;
    }
    if (line.startsWith("  ") && line.trim()) {
      // Indented continuation of the previous bullet.
      const last = blocksInScope()?.at(-1);
      if (last?.kind === "list" && last.items.length > 0) {
        last.items[last.items.length - 1] += ` ${line.trim()}`;
        continue;
      }
    }
    if (!line.trim()) {
      flushParagraph();
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();

  return releases;
}
