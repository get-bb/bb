import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BottomAnchoredScrollBody } from "@/components/ui/bottom-anchored-scroll-body";

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderBody(scrollOverlay?: ReactNode): string {
  return renderToStaticMarkup(
    <BottomAnchoredScrollBody
      footer={<div>Footer</div>}
      maxWidthClassName="max-w-none"
      scrollAnchorThreadId="thread-a"
      scrollOverlay={scrollOverlay}
    >
      <div data-timeline-row-id="row-a">row-a</div>
    </BottomAnchoredScrollBody>,
  );
}

function classTokens(className: string | undefined): string[] {
  return className?.split(/\s+/) ?? [];
}

describe("BottomAnchoredScrollBody scroll-anchor exclusion", () => {
  it("excludes only the content wrapper and keeps the sentinel outside it", () => {
    vi.stubGlobal("CSS", {
      supports: (property: string, value: string) =>
        property === "overflow-anchor" && value === "none",
    });
    const markup = renderBody();
    const structure = markup.match(
      /<div class="([^"]*)"[^>]*><div data-timeline-row-id="row-a">row-a<\/div><\/div><div class="scroll-bottom-anchor" aria-hidden="true"><\/div><div data-scroll-footer="" class="([^"]*)"><div>Footer<\/div><\/div>/,
    );

    expect(classTokens(structure?.[1])).toContain(
      "scroll-bottom-anchor-content",
    );
    expect(markup.split("scroll-bottom-anchor-content")).toHaveLength(2);
    expect(classTokens(structure?.[2])).toContain("[overflow-anchor:none]");
  });

  it("never applies the exclusion class where scroll anchoring is unsupported", () => {
    vi.stubGlobal("CSS", { supports: () => false });
    const markup = renderBody();

    expect(markup).not.toContain("scroll-bottom-anchor-content");
    expect(markup).toContain('class="scroll-bottom-anchor"');
  });
});

describe("BottomAnchoredScrollBody grid", () => {
  it("stacks the scroll port and overlay in one explicit minmax(auto,1fr) row", () => {
    vi.stubGlobal("CSS", { supports: () => false });
    const markup = renderBody(<nav>Overlay</nav>);
    const grid = markup.match(
      /^<div class="([^"]*)"><div data-page-scroll-viewport="" class="([^"]*)">/,
    );
    const overlay = markup.match(
      /<div data-scroll-overlay="" class="([^"]*)"><div class="pointer-events-auto"><nav>Overlay<\/nav><\/div><\/div><\/div>$/,
    );
    const gridTokens = classTokens(grid?.[1]);

    expect(gridTokens).toContain("grid");
    expect(
      gridTokens.filter((token) => token.startsWith("grid-rows-")),
    ).toEqual(["grid-rows-[minmax(auto,1fr)]"]);
    for (const item of [grid?.[2], overlay?.[1]]) {
      expect(classTokens(item)).toEqual(
        expect.arrayContaining(["row-start-1", "col-start-1", "min-h-0"]),
      );
    }
    expect(classTokens(grid?.[2])).toContain("thread-scrollbar");
  });
});
