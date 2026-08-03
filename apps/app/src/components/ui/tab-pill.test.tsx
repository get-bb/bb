// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TabPill } from "./tab-pill";

afterEach(cleanup);

describe("TabPill", () => {
  it("reveals a tab close action only from tab hover or keyboard focus", () => {
    render(
      <TabPill
        label="release notes"
        title="release notes"
        isActive
        onSelect={vi.fn()}
        closeAction={{
          onClose: vi.fn(),
          closeLabel: "Close release notes",
          closeTooltip: "Close tab",
        }}
      />,
    );

    const close = screen.getByRole("button", { name: "Close release notes" });
    expect(close.className).toContain("opacity-0");
    expect(close.className).toContain("group-hover/tab-pill:opacity-100");
    expect(close.className).toContain("focus-visible:opacity-100");
  });

  it("uses the shared active shell for an accessible icon-only tab", () => {
    render(
      <TabPill
        label="Info"
        ariaLabel="Show thread info panel"
        iconOnly
        leadingVisual={<span aria-hidden>i</span>}
        title="Thread info"
        isActive
        onSelect={vi.fn()}
        closeAction={null}
      />,
    );

    const tab = screen.getByRole("button", {
      name: "Show thread info panel",
    });
    expect(tab.getAttribute("aria-pressed")).toBe("true");
    expect(tab.parentElement?.classList).toContain("bg-muted");
    expect(screen.getByText("Info").classList).toContain("sr-only");
  });

  it("uses a quiet underline when the tab owns a full-width panel", () => {
    render(
      <TabPill
        label="Browser"
        title="Browser"
        isActive
        activeTreatment="underline"
        onSelect={vi.fn()}
        closeAction={null}
      />,
    );

    const shell = screen.getByRole("button", { name: "Browser" }).parentElement;
    expect(shell?.classList).toContain("after:h-0.5");
    expect(shell?.classList).not.toContain("bg-muted");
  });

  it("holds associated controls until overlapping pointer and keyboard intent both end", () => {
    const onRevealHoldChange = vi.fn();
    render(
      <TabPill
        label="Example Docs"
        title="Example Docs"
        isActive
        onRevealHoldChange={onRevealHoldChange}
        onSelect={vi.fn()}
        closeAction={null}
      />,
    );

    const tab = screen.getByRole("button", { name: "Example Docs" });
    if (tab.parentElement === null) throw new Error("Tab shell missing");
    fireEvent.pointerEnter(tab.parentElement);
    fireEvent.focus(tab);
    fireEvent.pointerLeave(tab.parentElement);

    expect(onRevealHoldChange.mock.calls).toEqual([[true]]);

    fireEvent.blur(tab);

    expect(onRevealHoldChange.mock.calls).toEqual([[true], [false]]);
  });
});
