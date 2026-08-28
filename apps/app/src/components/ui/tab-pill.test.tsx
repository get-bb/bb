// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TabPill } from "./tab-pill";

afterEach(cleanup);

describe("TabPill", () => {
  it("keeps an icon-only tab reachable by its accessible name", () => {
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

    const tab = screen.getByRole("button", { name: "Show thread info panel" });
    expect(tab.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Info").classList).toContain("sr-only");
  });

  it("reports the pressed state of an inactive tab", () => {
    render(
      <TabPill
        label="Browser"
        title="Browser"
        isActive={false}
        onSelect={vi.fn()}
        closeAction={null}
      />,
    );

    expect(
      screen
        .getByRole("button", { name: "Browser" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });
});
