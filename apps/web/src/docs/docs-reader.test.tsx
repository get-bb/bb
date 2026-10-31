import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SearchResultItem } from "fumadocs-core/search/client";
import { defineDocs } from "fumadocs-mdx/config";
import { dynamic } from "fumadocs-mdx/runtime/dynamic";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it } from "vitest";

import { breadcrumbJsonLd } from "./breadcrumbs";
import { DocsH2, DocsH3 } from "./docs-headings";
import { searchEntries, tableRowText } from "./search-results";

const dir = mkdtempSync(path.join(tmpdir(), "bb-docs-reader-"));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function compileHtml(source: string): Promise<string> {
  const file = path.join(dir, "page.mdx");
  writeFileSync(file, source);
  const runtime = await dynamic(
    {
      docs: defineDocs({
        dir,
        docs: { async: true },
      }),
    },
    { environment: "test", outDir: dir },
  );
  const collection = await runtime.docs("docs", dir, {}, [
    { info: { path: "page.mdx", fullPath: file }, data: { title: "Test" } },
  ]);
  const { body: Body } = await collection.docs[0]!.load();
  return renderToStaticMarkup(<Body components={{ h2: DocsH2, h3: DocsH3 }} />);
}

function record(
  type: "page" | "heading" | "text",
  content: string,
  url: string,
  breadcrumbs?: string[],
) {
  return {
    id: `${type}-${url}-${content}`,
    type,
    content,
    url,
    breadcrumbs,
    hastContent: { type: "root" as const, children: [] },
  };
}

describe("docs search results", () => {
  const items: SearchResultItem[] = [
    record("page", "bb is slow", "/docs/bb-is-slow", ["Troubleshooting"]),
    {
      type: "table",
      id: "row-1",
      columns: 3,
      rows: [
        record(
          "text",
          "| What you see | Likely cause | Fix |\n| --- | --- | --- |\n| Memory grows all day | A plugin polling | Disable `plugins` one at a time |",
          "/docs/bb-is-slow#find-the-cause",
        ),
      ],
    },
    record("heading", "Large projects", "/docs/bb-is-slow#large-projects"),
    record("page", "CLI", "/docs/cli", ["Reference"]),
    record("text", "Run **bb status** to check", "/docs/cli#bb-status"),
  ];

  it("keeps table rows and links them to their section", () => {
    expect(searchEntries(items)).toContainEqual({
      id: "text-/docs/bb-is-slow#find-the-cause-| What you see | Likely cause | Fix |\n| --- | --- | --- |\n| Memory grows all day | A plugin polling | Disable `plugins` one at a time |",
      url: "/docs/bb-is-slow#find-the-cause",
      kind: "table",
      text: "Memory grows all day · A plugin polling · Disable plugins one at a time",
      page: "bb is slow",
    });
  });

  it("shows each hit under its page title and section", () => {
    const entries = searchEntries(items);
    expect(
      entries.map((entry) => [
        entry.kind,
        entry.text,
        entry.page ?? entry.section,
      ]),
    ).toEqual([
      ["page", "bb is slow", "Troubleshooting"],
      [
        "table",
        "Memory grows all day · A plugin polling · Disable plugins one at a time",
        "bb is slow",
      ],
      ["heading", "Large projects", "bb is slow"],
      ["page", "CLI", "Reference"],
      ["text", "Run bb status to check", "CLI"],
    ]);
  });

  it("reads the row, not the header, of a table record", () => {
    expect(
      tableRowText("| A | B |\n| --- | --- |\n| one \\| two | three |"),
    ).toBe("one | two · three");
    expect(tableRowText("plain text")).toBe("plain text");
  });
});

describe("docs headings", () => {
  it("give h2 and h3 ids, explicit [#ids] and a copy-link anchor", async () => {
    const html = await compileHtml(
      [
        "## Change the folder [#change-folder]",
        "",
        "### On a phone",
        "",
        "Text.",
      ].join("\n"),
    );
    expect(html).toContain(
      '<h2 id="change-folder">Change the folder<a class="docs-anchor" href="#change-folder" aria-label="Copy link to this section">#</a></h2>',
    );
    expect(html).toContain(
      '<h3 id="on-a-phone">On a phone<a class="docs-anchor" href="#on-a-phone"',
    );
    expect(html).not.toContain("[#change-folder]");
  });
});

describe("docs breadcrumbs", () => {
  it("describes the page's place in the docs as a BreadcrumbList", () => {
    const data = JSON.parse(
      breadcrumbJsonLd([
        { name: "Docs", url: "/docs" },
        { name: "Reference", url: "/docs/cli" },
        { name: "Keyboard <shortcuts>", url: "/docs/keyboard-shortcuts" },
      ]),
    );
    expect(data["@type"]).toBe("BreadcrumbList");
    expect(data.itemListElement[2]).toEqual({
      "@type": "ListItem",
      position: 3,
      name: "Keyboard <shortcuts>",
      item: "https://getbb.app/docs/keyboard-shortcuts",
    });
    expect(breadcrumbJsonLd([{ name: "<", url: "/docs" }])).not.toContain("<");
  });
});
