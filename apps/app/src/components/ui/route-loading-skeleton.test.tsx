import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RouteLoadingSkeleton } from "./route-loading-skeleton";

function renderSkeleton(isBoundedPane: boolean) {
  const markup = renderToStaticMarkup(
    <RouteLoadingSkeleton isBoundedPane={isBoundedPane} />,
  );
  const match = markup.match(
    /^<div class="([^"]*)"[^>]*data-testid="route-loading-skeleton"[^>]*><div class="([^"]*)"/,
  );
  return {
    skeleton: match?.[1]?.split(" ") ?? [],
    header: match?.[2]?.split(" ") ?? [],
  };
}

describe("RouteLoadingSkeleton", () => {
  it("bleeds through standalone page padding", () => {
    const { skeleton, header } = renderSkeleton(false);

    expect(skeleton).toEqual(
      expect.arrayContaining(["-mx-4", "-mt-4", "md:-mx-5", "md:-mt-5"]),
    );
    expect(header).toContain("pl-12");
  });

  it("keeps bounded-pane placeholders inside their pane", () => {
    const { skeleton, header } = renderSkeleton(true);

    expect(skeleton).toContain("flex");
    for (const token of ["-mx-4", "-mt-4", "md:-mx-5", "md:-mt-5"]) {
      expect(skeleton).not.toContain(token);
    }
    expect(header).toContain("px-4");
    expect(header).not.toContain("pl-12");
  });
});
