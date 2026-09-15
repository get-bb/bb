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
      splitTypstPages(
        '<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>',
      ),
    ).toThrow(/any page/);
  });
});
