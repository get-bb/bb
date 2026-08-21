import changelogSource from "../../../../../CHANGELOG.md?raw";

const LATEST_CHANGELOG_SOURCE_URL =
  "https://raw.githubusercontent.com/get-bb/bb/main/CHANGELOG.md";

export type ChangelogBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] };

interface ChangelogSection {
  title: string;
  blocks: ChangelogBlock[];
}

/**
 * The same release shape used by getbb.app/changelog: introductory blocks,
 * then titled sections containing paragraphs and lists.
 */
interface ChangelogEntry {
  version: string;
  lede: ChangelogBlock[];
  sections: ChangelogSection[];
}

interface ChangelogReleaseMeta {
  date: string;
  headline: string;
}

/** Presentation metadata from the canonical changelog page. */
export const CHANGELOG_RELEASE_META: Record<string, ChangelogReleaseMeta> = {
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
  "0.35.0": { date: "August 4, 2026", headline: "Plugins" },
  "0.34.0": {
    date: "July 28, 2026",
    headline: "Fresher models, cross-provider questions",
  },
  "0.33.0": {
    date: "July 21, 2026",
    headline: "Quieter updates and safer approvals",
  },
  "0.0.31": { date: "July 17, 2026", headline: "Splits for everyone" },
  "0.0.30": {
    date: "July 14, 2026",
    headline: "Multi-machine workflows and bb Connect",
  },
  "0.0.29": {
    date: "July 9, 2026",
    headline: "More agents, more models, redesigned Settings",
  },
};

/** Parse the repo changelog with the same block boundaries as the website. */
export function parseChangelogEntries(source: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let entry: ChangelogEntry | null = null;
  let section: ChangelogSection | null = null;
  let paragraph: string[] = [];

  const blocksInScope = (): ChangelogBlock[] | null => {
    if (entry === null) {
      return null;
    }
    return section === null ? entry.lede : section.blocks;
  };

  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }
    const text = paragraph.join(" ").trim();
    paragraph = [];
    const blocks = blocksInScope();
    if (text !== "" && blocks !== null) {
      blocks.push({ kind: "paragraph", text });
    }
  };

  for (const rawLine of source.split("\n")) {
    const line = rawLine.trimEnd();

    if (line.startsWith("## ") && !line.startsWith("### ")) {
      flushParagraph();
      section = null;
      entry = { version: line.slice(3).trim(), lede: [], sections: [] };
      entries.push(entry);
      continue;
    }
    if (entry === null) {
      continue;
    }
    if (line.startsWith("### ")) {
      flushParagraph();
      section = { title: line.slice(4).trim(), blocks: [] };
      entry.sections.push(section);
      continue;
    }
    if (line.startsWith("- ")) {
      flushParagraph();
      const blocks = blocksInScope();
      if (blocks === null) {
        continue;
      }
      const last = blocks.at(-1);
      const list =
        last?.kind === "list" ? last : { kind: "list" as const, items: [] };
      if (last !== list) {
        blocks.push(list);
      }
      list.items.push(line.slice(2).trim());
      continue;
    }
    if (line.startsWith("  ") && line.trim() !== "") {
      const last = blocksInScope()?.at(-1);
      if (last?.kind === "list" && last.items.length > 0) {
        last.items[last.items.length - 1] += ` ${line.trim()}`;
        continue;
      }
    }
    if (line.trim() === "") {
      flushParagraph();
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();

  return entries;
}

export const CHANGELOG_ENTRIES = parseChangelogEntries(changelogSource);

/** The newest bundled release, used when the live changelog is unavailable. */
export const LATEST_CHANGELOG_ENTRY: ChangelogEntry | null =
  CHANGELOG_ENTRIES[0] ?? null;

/** Read the same current changelog source that getbb.app builds from. */
export async function fetchLatestChangelogEntry(
  fetchFn: typeof fetch,
  signal?: AbortSignal,
): Promise<ChangelogEntry> {
  const response = await fetchFn(LATEST_CHANGELOG_SOURCE_URL, { signal });
  if (!response.ok) {
    throw new Error(`Changelog request failed (${response.status})`);
  }
  const [entry] = parseChangelogEntries(await response.text());
  if (entry === undefined) {
    throw new Error("The changelog has no releases");
  }
  return entry;
}
