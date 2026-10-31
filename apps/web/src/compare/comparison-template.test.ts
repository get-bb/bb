import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { COMPARISONS } from "./comparisons";
import { ComparePage } from "./compare-page";

const pagesDirectory = fileURLToPath(new URL("./pages/", import.meta.url));

function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, "");
}

function headings(html: string): string[] {
  return [...html.matchAll(/<h([12])(?:\s[^>]*)?>([\s\S]*?)<\/h\1>/g)].map(
    (match) => text(match[2]),
  );
}

describe("comparison template", () => {
  it("registers one comparison per page module", () => {
    const pages = readdirSync(pagesDirectory).filter(
      (name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx"),
    );
    expect(COMPARISONS).toHaveLength(pages.length);
    expect(new Set(COMPARISONS.map((c) => c.slug)).size).toBe(pages.length);
  });

  it.each(COMPARISONS)("$slug renders the shared slot order", (comparison) => {
    const html = renderToStaticMarkup(
      createElement(ComparePage, { comparison }),
    );
    const slots = [
      ...html.matchAll(
        /<(?:header|section) class="(hero cmp-hero|band[^"]*|cmp-section cmp-faq|cmp-section|closer)"/g,
      ),
    ]
      .map(([, className]) => {
        if (className === "hero cmp-hero") return "hero";
        if (className.startsWith("band")) return "highlight";
        if (className === "cmp-section cmp-faq") return "faq";
        if (className === "closer") return "closer";
        return "table";
      })
      .join(" ");
    expect(slots).toMatch(/^hero highlight table( highlight)+ faq closer$/);
    expect(html).toContain('id="cmp-table-title"');
  });

  it.each(COMPARISONS)("$slug has no repeated section", (comparison) => {
    const html = renderToStaticMarkup(
      createElement(ComparePage, { comparison }),
    );
    const titles = headings(html);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it.each(COMPARISONS)("$slug follows the page rules", (comparison) => {
    const html = renderToStaticMarkup(
      createElement(ComparePage, { comparison }),
    );
    expect(html).not.toMatch(
      /better fit|What do .*? users value|When should I stay|reddit\.com|\b(?:Checked|As of|Updated) (?:January|February|March|April|May|June|July|August|September|October|November|December)\b|\/install\//i,
    );
  });
});
