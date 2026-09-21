// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { splitTypstPages } from "./typst-pages";
import { TWO_PAGE_SVG } from "./typst-svg.fixture";

describe("splitTypstPages", () => {
  it("returns one svg per page with its own size", () => {
    const pages = splitTypstPages(TWO_PAGE_SVG);

    expect(pages).toHaveLength(2);
    expect(pages[0]).toMatchObject({ widthPt: 200, heightPt: 100 });
    expect(pages[1]).toMatchObject({ widthPt: 200, heightPt: 100 });
  });

  it("keeps shared styles and definitions in each page", () => {
    const [first, second] = splitTypstPages(TWO_PAGE_SVG);

    expect(first!.svg).toContain("typst-text");
    expect(first!.svg).toContain('id="clip"');
    expect(second!.svg).toContain("typst-text");
    expect(second!.svg).toContain('id="clip"');
  });

  it("isolates the page content and resets its offset", () => {
    const [first, second] = splitTypstPages(TWO_PAGE_SVG);

    expect(first!.svg).toContain('d="M0 0h10v10z"');
    expect(first!.svg).not.toContain('d="M20 20h10v10z"');
    expect(second!.svg).toContain('d="M20 20h10v10z"');
    expect(second!.svg).not.toContain('d="M0 0h10v10z"');
    expect(first!.svg).toContain('transform="translate(0, 0)"');
    expect(second!.svg).toContain('transform="translate(0, 0)"');
    expect(first!.svg).toContain('viewBox="0 0 200 100"');
    expect(first!.svg).toContain('width="200pt"');
    expect(first!.svg).toContain('height="100pt"');
  });

  it("rejects documents that are not rendered typst svg", () => {
    expect(() => splitTypstPages("<html></html>")).toThrow(/SVG document/);
    expect(() =>
      splitTypstPages('<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>'),
    ).toThrow(/any page/);
  });

  it("keeps root attributes and drops the document size from them", () => {
    const [first] = splitTypstPages(TWO_PAGE_SVG);

    expect(first!.svg).toContain('class="typst-doc"');
    expect(first!.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(first!.svg).not.toContain('viewBox="0 0 200 200"');
  });

  it("splits pages separated by whitespace and comments", () => {
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg">',
      "<style>.typst-text{fill:#000}</style>",
      '<g class="typst-page" transform="translate(0, 0)" data-page-width="200" data-page-height="100">',
      '<g class="typst-group"><path d="M0 0h10v10z"/></g>',
      "</g>",
      "\n  <!-- between pages -->\n",
      '<g class="typst-page" transform="translate(0, 100)" data-page-width="200" data-page-height="100">',
      '<g class="typst-group"><path d="M20 20h10v10z"/></g>',
      "</g>",
      "</svg>",
    ].join("");

    const pages = splitTypstPages(svg);

    expect(pages).toHaveLength(2);
    expect(pages[0]!.svg).toContain('d="M0 0h10v10z"');
    expect(pages[1]!.svg).toContain('d="M20 20h10v10z"');
  });

  it("does not mistake nested group names for page boundaries", () => {
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg">',
      '<g class="typst-page" transform="translate(0, 0)" data-page-width="200" data-page-height="100">',
      '<g class="typst-group"><g class="typst-group"/><glyph/></g>',
      "</g>",
      "</svg>",
    ].join("");

    const [first] = splitTypstPages(svg);

    expect(first!.svg).toContain('<g class="typst-group"/>');
    expect(first!.svg).toContain("<glyph/>");
  });

  it("does not rewrite transforms inside page content", () => {
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg">',
      '<g class="typst-page" data-page-width="200" data-page-height="100">',
      '<g class="typst-group" transform="translate(5, 7)"><path d="M0 0h10v10z"/></g>',
      "</g>",
      "</svg>",
    ].join("");

    const [first] = splitTypstPages(svg);

    expect(first!.svg).toContain('transform="translate(5, 7)"');
  });

  it("falls back to the dom splitter for documents the scanner rejects", () => {
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg">',
      '<g class="typst-page" transform="translate(0, 0)" data-page-width="200" data-page-height="100">',
      '<g class="typst-group"><path d="M0 0h10v10z"/></g>',
      "</g>",
      '<defs><clipPath id="late"/></defs>',
      '<g class="typst-page" transform="translate(0, 100)" data-page-width="200" data-page-height="100">',
      '<g class="typst-group"><path d="M20 20h10v10z"/></g>',
      "</g>",
      "</svg>",
    ].join("");

    const pages = splitTypstPages(svg);

    expect(pages).toHaveLength(2);
    expect(pages[0]!.svg).toContain('id="late"');
    expect(pages[0]!.svg).toContain('d="M0 0h10v10z"');
    expect(pages[0]!.svg).not.toContain('d="M20 20h10v10z"');
  });
});
