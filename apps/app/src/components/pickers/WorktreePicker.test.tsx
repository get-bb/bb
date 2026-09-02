// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorktreePicker } from "./WorktreePicker";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WorktreePicker", () => {
  it("applies viewport-aware vertical overflow constraints to the menu", () => {
    render(
      <WorktreePicker
        options={[]}
        failures={[]}
        value={null}
        onChange={vi.fn()}
        modal={false}
      />,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "Worktree" }), {
      button: 0,
    });

    const menu = screen.getByRole("menu");
    expect(menu.className).toContain(
      "max-h-[var(--radix-dropdown-menu-content-available-height)]",
    );
    expect(menu.className).toContain("overflow-y-auto");
    expect(menu.className).toContain("overscroll-contain");
  });
});
