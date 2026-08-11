// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStickyBottomScroll } from "./useStickyBottomScroll";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function StickyScrollProbe({ contentKey }: { contentKey: string }) {
  const sticky = useStickyBottomScroll<HTMLDivElement>({
    contentKey,
    streaming: true,
  });
  return (
    <div
      ref={sticky.ref}
      data-testid="scroll"
      onScroll={sticky.onScroll}
      onWheel={sticky.onWheel}
    />
  );
}

describe("useStickyBottomScroll", () => {
  it("uses a cached maximum offset in the scroll handler", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const { getByTestId, rerender } = render(
      <StickyScrollProbe contentKey="first" />,
    );
    const scroll = getByTestId("scroll");
    let layoutReads = 0;
    let scrollTop = 0;
    Object.defineProperties(scroll, {
      scrollHeight: {
        configurable: true,
        get: () => {
          layoutReads += 1;
          return 120;
        },
      },
      clientHeight: {
        configurable: true,
        get: () => {
          layoutReads += 1;
          return 20;
        },
      },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = value;
        },
      },
    });

    rerender(<StickyScrollProbe contentKey="second" />);
    expect(scrollTop).toBe(100);
    layoutReads = 0;

    scrollTop = 20;
    fireEvent.wheel(scroll);
    fireEvent.scroll(scroll);

    expect(layoutReads).toBe(0);
    rerender(<StickyScrollProbe contentKey="third" />);
    expect(scrollTop).toBe(20);
  });
});
