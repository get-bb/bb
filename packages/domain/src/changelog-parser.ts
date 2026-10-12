export type ChangelogBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] };

type ChangelogSection = {
  title: string;
  blocks: ChangelogBlock[];
};

export type ChangelogEntry = {
  version: string;
  lede: ChangelogBlock[];
  sections: ChangelogSection[];
};

export function parseChangelog(markdown: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let entry: ChangelogEntry | null = null;
  let section: ChangelogSection | null = null;
  let paragraph: string[] = [];

  const blocksInScope = (): ChangelogBlock[] | null => {
    if (!entry) {
      return null;
    }
    return section ? section.blocks : entry.lede;
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
      entry = { version: line.slice(3).trim(), lede: [], sections: [] };
      entries.push(entry);
      continue;
    }
    if (!entry) {
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

  return entries;
}
