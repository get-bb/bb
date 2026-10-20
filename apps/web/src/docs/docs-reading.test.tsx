import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DocBody } from "./doc-body";
import { DocPage } from "./doc-page";
import { DOCS, getDoc } from "./docs";
import { DocsHome } from "./docs-home";

const markdown = `## Use **plugins**

> Install the Playgrounds plugin.

:::note
Read the source before installing.
:::

### Read [the source](/plugin-guide)

## Use **plugins**

| Source | Action |
| --- | --- |
| Marketplace | Review |
`;

describe("docs reading", () => {
  it("renders stable heading targets, agent prompts, notes, and a keyboard-scrollable table", () => {
    const html = renderToStaticMarkup(<DocBody body={markdown} />);
    expect(html).toContain('<h2 id="use-plugins">');
    expect(html).toContain('<h2 id="use-plugins-1">');
    expect(html).toContain('<h3 id="read-the-source">');
    expect(html).toContain('href="#use-plugins-1"');
    expect(html).toContain('<a href="/plugin-guide">the source</a>');
    expect(html).toMatch(
      /<blockquote[^>]*>[\s\S]*Install the Playgrounds plugin\.[\s\S]*<\/blockquote>/,
    );
    expect(html).toMatch(
      /<aside class="docs-note">[\s\S]*Read the source before installing\.[\s\S]*<\/aside>/,
    );
    expect(html).toMatch(/<div[^>]*role="region"[^>]*tabindex="0"><table>/);
    expect(html).toContain("<th>Source</th>");
  });

  it("makes every published article reachable from the hub without hydration", () => {
    const html = renderToStaticMarkup(<DocsHome />);
    const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/)?.[1];
    expect(main).toBeDefined();
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    for (const doc of DOCS) {
      expect(main).toContain(`href="${doc.path}"`);
    }
  });

  it("serves one article title and working in-flow compact contents in the initial HTML", async () => {
    const doc = await getDoc("plugins");
    if (!doc) throw new Error("The published plugins article is missing");
    const html = renderToStaticMarkup(
      <DocPage meta={doc.meta} body={doc.body} />,
    );
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain(`<h1>${doc.meta.title}</h1>`);
    const compact = html.match(
      /<details class="docs-compact-contents">([\s\S]*?)<\/details>/,
    )?.[1];
    expect(compact).toContain("<summary>Contents</summary>");
    expect(compact).toContain(`href="${doc.meta.path}" aria-current="page"`);
    for (const heading of doc.meta.headings) {
      expect(compact).toContain(`href="#${heading.id}"`);
      expect(html).toContain(`id="${heading.id}"`);
    }
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("inert=");
  });
});
