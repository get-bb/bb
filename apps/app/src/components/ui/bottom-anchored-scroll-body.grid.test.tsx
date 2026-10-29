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

describe("BottomAnchoredScrollBody grid", () => {
  it("stacks the scroll port and overlay in one explicit minmax(auto,1fr) row", () => {
    vi.stubGlobal("CSS", { supports: () => false });
    const markup = renderBody(<nav>Overlay</nav>);
    const grid = markup.match(
      /^<div class="([^"]*)"><div data-page-scroll-viewport="" class="([^"]*)">/,
    );
    const overlay = markup.match(
      /<div data-scroll-overlay="" class="([^"]*)"><nav>Overlay<\/nav><\/div><\/div>$/,
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
