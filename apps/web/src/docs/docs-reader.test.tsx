import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defineDocs } from "fumadocs-mdx/config";
import { dynamic } from "fumadocs-mdx/runtime/dynamic";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it } from "vitest";

import { breadcrumbJsonLd } from "./breadcrumbs";
import { DocsH2, DocsH3 } from "./docs-headings";

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
