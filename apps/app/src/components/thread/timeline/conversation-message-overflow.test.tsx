// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  ConversationMessageOverflowToggle,
  useIsOverflowing,
} from "./conversation-message-overflow";
import {
  installDriveableResizeObserver,
  installElementOverflowMetrics,
  restoreElementOverflowMetrics,
} from "./conversation-message-overflow.test-utils";

interface OverflowHarnessProps {
  text: string;
}

function OverflowHarness({ text }: OverflowHarnessProps) {
  const [expanded, setExpanded] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);
  const isOverflowing = useIsOverflowing({
    elementRef: textRef,
    enabled: !expanded,
    measurementKey: text,
  });
  const showToggle = expanded || isOverflowing;

  return (
    <div>
      {expanded ? null : <div ref={textRef}>{text}</div>}
      {showToggle ? (
        <ConversationMessageOverflowToggle
          expanded={expanded}
          labels={{ collapsed: "Show more", expanded: "Show less" }}
          onToggle={() => setExpanded((current) => !current)}
        />
      ) : null}
    </div>
  );
}

afterEach(() => {
  cleanup();
});

describe("conversation message overflow", () => {
  it("shows the overflow toggle after measurement and switches labels when expanded", () => {
    const descriptors = installElementOverflowMetrics({
      clientHeight: 20,
      scrollHeight: 100,
      clientWidth: 100,
      scrollWidth: 100,
    });

    try {
      render(<OverflowHarness text="Line 1\nLine 2\nLine 3" />);

      const showMore = screen.getByRole("button", { name: "Show more" });
      expect(showMore.getAttribute("aria-expanded")).toBe("false");

      fireEvent.click(showMore);

      const showLess = screen.getByRole("button", { name: "Show less" });
      expect(showLess.getAttribute("aria-expanded")).toBe("true");

      fireEvent.click(showLess);

      expect(
        screen.getByRole("button", { name: "Show more" }),
      ).toBeTruthy();
    } finally {
      restoreElementOverflowMetrics(descriptors);
    }
  });

  it("detects horizontal overflow", () => {
    const descriptors = installElementOverflowMetrics({
      clientHeight: 20,
      scrollHeight: 20,
      clientWidth: 100,
      scrollWidth: 200,
    });

    try {
      render(<OverflowHarness text="A long single-line message" />);

      expect(
        screen.getByRole("button", { name: "Show more" }),
      ).toBeTruthy();
    } finally {
      restoreElementOverflowMetrics(descriptors);
    }
  });

  it(
    // Regression: an expanding row unmounts its collapsed preview, and a
    // detached node reports scroll/client = 0. Before the isConnected guard,
    // the ResizeObserver callback would flip measurement to "fits" and the
    // caller's `expandable` flag would collapse to false mid-click — the row
    // would visibly bounce back to collapsed and lose its toggle button.
    "ignores ResizeObserver callbacks fired against a now-detached element",
    () => {
      const descriptors = installElementOverflowMetrics({
        clientHeight: 20,
        scrollHeight: 20,
        clientWidth: 100,
        scrollWidth: 200,
      });
      const resizeObserver = installDriveableResizeObserver();

      try {
        render(<OverflowHarness text="A long single-line message" />);

        // Initial measurement: overflowing → Show more button visible.
        fireEvent.click(screen.getByRole("button", { name: "Show more" }));
        // Harness conditionally unmounts the ref'd div on expand, mimicking
        // how `ExpandableTimelineRow` swaps the collapsed preview for the
        // expanded body. The original observed node is now detached.
        expect(
          screen.queryByRole("button", { name: "Show less" }),
        ).toBeTruthy();

        // Simulate the browser firing the observer once more for the detached
        // node. The guard must drop this measurement on the floor — otherwise
        // the toggle disappears and the user loses the way to collapse.
        act(() => {
          resizeObserver.triggerAll();
        });

        expect(
          screen.getByRole("button", { name: "Show less" }),
        ).toBeTruthy();
      } finally {
        resizeObserver.restore();
        restoreElementOverflowMetrics(descriptors);
      }
    },
  );
});
