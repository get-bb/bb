// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  renderBuiltInSidebarSection,
  type BuiltInSidebarSectionOptionsById,
} from "./BuiltInSidebarSection";
import { NO_COLLAPSED_CHILD_ACTIVITY } from "@bb/client-core";

const SECTIONS: BuiltInSidebarSectionOptionsById = {
  pinned: {
    label: "Pinned",
    content: <div>Pinned content</div>,
  },
  threads: {
    label: "Threads",
    content: <div>Threads content</div>,
  },
};

function BuiltInSectionsProbe({ showPinned }: { showPinned: boolean }) {
  const sharedProps = {
    sections: SECTIONS,
    disabled: true,
    collapsedSectionIds: new Set<"pinned" | "threads">(),
    onToggleCollapsed: vi.fn(),
    showPinnedSection: showPinned,
  };

  return (
    <>
      {renderBuiltInSidebarSection({
        ...sharedProps,
        sectionId: "pinned",
      })}
      {renderBuiltInSidebarSection({
        ...sharedProps,
        sectionId: "threads",
      })}
    </>
  );
}

afterEach(() => cleanup());

describe("built-in sidebar section renderer", () => {
  it("hides Pinned without hiding Threads, then restores Pinned", () => {
    const result = render(<BuiltInSectionsProbe showPinned={false} />);

    expect(screen.queryByText("Pinned content")).toBeNull();
    expect(screen.getByText("Threads content")).not.toBeNull();

    result.rerender(<BuiltInSectionsProbe showPinned />);

    expect(screen.getByText("Pinned content")).not.toBeNull();
    expect(screen.getByText("Threads content")).not.toBeNull();
    expect(result.container.querySelector('[data-icon="Pin"]')).toBeNull();
  });

  it("surfaces shared activity when Threads is collapsed", () => {
    render(
      renderBuiltInSidebarSection({
        collapsedSectionIds: new Set(["threads"]),
        disabled: true,
        onToggleCollapsed: vi.fn(),
        sectionId: "threads",
        sections: {
          ...SECTIONS,
          threads: {
            ...SECTIONS.threads,
            activity: {
              ...NO_COLLAPSED_CHILD_ACTIVITY,
              goal: true,
              working: true,
            },
          },
        },
        showPinnedSection: false,
      }),
    );

    expect(screen.queryByText("Threads content")).toBeNull();
    expect(screen.getAllByLabelText("Goal active")).not.toHaveLength(0);
  });
});
