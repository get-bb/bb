// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RouteLoadingSkeleton } from "./route-loading-skeleton";

const STANDALONE_BLEED_CLASSES = ["-mx-4", "-mt-4", "md:-mx-5", "md:-mt-5"];

afterEach(() => {
  cleanup();
});

function renderSkeleton(isBoundedPane: boolean) {
  render(<RouteLoadingSkeleton isBoundedPane={isBoundedPane} />);
  const skeleton = screen.getByRole("status", { name: "Loading" });
  const header = skeleton.firstElementChild;
  if (header === null) throw new Error("Skeleton header row is missing");
  return { skeleton: skeleton.classList, header: header.classList };
}

describe("RouteLoadingSkeleton", () => {
  it("bleeds through standalone page padding", () => {
    const { skeleton, header } = renderSkeleton(false);

    for (const token of STANDALONE_BLEED_CLASSES) {
      expect(skeleton.contains(token), token).toBe(true);
    }
    expect(header.contains("pl-12")).toBe(true);
  });

  it("keeps bounded-pane placeholders inside their pane", () => {
    const { skeleton, header } = renderSkeleton(true);

    expect(skeleton.contains("flex")).toBe(true);
    for (const token of STANDALONE_BLEED_CLASSES) {
      expect(skeleton.contains(token), token).toBe(false);
    }
    expect(header.contains("px-4")).toBe(true);
    expect(header.contains("pl-12")).toBe(false);
  });
});
