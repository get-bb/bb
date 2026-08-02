// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TabPill } from "./tab-pill";

afterEach(cleanup);

describe("TabPill", () => {
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

  it("reveals associated controls from pointer or keyboard intent", () => {
    const onReveal = vi.fn();
    render(
      <TabPill
        label="Example Docs"
        title="Example Docs"
        isActive
        onReveal={onReveal}
        onSelect={vi.fn()}
        closeAction={null}
      />,
    );

    const tab = screen.getByRole("button", { name: "Example Docs" });
    if (tab.parentElement === null) throw new Error("Tab shell missing");
    fireEvent.pointerEnter(tab.parentElement);
    fireEvent.focus(tab);

    expect(onReveal).toHaveBeenCalledTimes(2);
  });
});
