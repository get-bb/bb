import type { SearchResultItem } from "fumadocs-core/search/client";

const MAX_PAGES = 6;
const MAX_HITS_PER_PAGE = 3;
const MAX_TABLE_ROWS = 2;

export interface DocsSearchEntry {
  id: string;
  url: string;
  kind: "page" | "heading" | "text" | "table";
  text: string;
  section?: string;
  page?: string;
}

export function plainMarkdown(markdown: string): string {
  return markdown
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/\\\|/gu, "|")
    .replace(/`|\*\*|__/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/u, "")
    .replace(/(?<!\\)\|$/u, "")
    .split(/(?<!\\)\|/u)
    .map((cell) => plainMarkdown(cell))
    .filter((cell) => cell.length > 0);
}

export function tableRowText(markdown: string): string {
  const rows = markdown
    .split("\n")
    .filter((line) => line.trim().startsWith("|"))
    .filter((line) => !/^\|?[\s:|-]+\|?$/u.test(line.trim()));
  const row = rows.at(-1);
  return row === undefined
    ? plainMarkdown(markdown)
    : tableCells(row).join(" · ");
}

export function searchEntries(
  items: readonly SearchResultItem[],
): DocsSearchEntry[] {
  const entries: DocsSearchEntry[] = [];
  let page: string | undefined;
  let pages = 0;
  let hits = 0;
  for (const item of items) {
    if (item.type === "page") {
      if (pages === MAX_PAGES) break;
      pages += 1;
      hits = 0;
      page = item.content;
      entries.push({
        id: item.id,
        url: item.url,
        kind: "page",
        text: item.content,
        section: item.breadcrumbs?.[0],
      });
      continue;
    }
    if (hits === MAX_HITS_PER_PAGE) continue;
    hits += 1;
    if (item.type === "table") {
      for (const row of item.rows.slice(0, MAX_TABLE_ROWS)) {
        entries.push({
          id: row.id,
          url: row.url,
          kind: "table",
          text: tableRowText(row.content),
          page,
        });
      }
      continue;
    }
    entries.push({
      id: item.id,
      url: item.url,
      kind: item.type,
      text: plainMarkdown(item.content),
      page,
    });
  }
  return entries;
}
