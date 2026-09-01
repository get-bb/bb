// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RootComposeRightPanelToggle } from "./RootComposeView";

const { preloadThreadSecondaryPanel } = vi.hoisted(() => ({
  preloadThreadSecondaryPanel: vi.fn(),
}));

vi.mock(
  "@/components/secondary-panel/lazySecondaryPanelComponents",
  async (importOriginal) => ({
    ...(await importOriginal()),
    preloadThreadSecondaryPanel,
  }),
);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RootComposeRightPanelToggle", () => {
  it("uses a disclosure state without painting the whole click target as selected", () => {
    const onToggle = vi.fn();

    render(<RootComposeRightPanelToggle isOpen onToggle={onToggle} />);

    const button = screen.getByRole("button", { name: "Hide right panel" });
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.getAttribute("aria-pressed")).toBeNull();

    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("starts loading the panel from pointer or keyboard intent", () => {
    render(<RootComposeRightPanelToggle isOpen={false} onToggle={vi.fn()} />);

    const button = screen.getByRole("button", { name: "Show right panel" });
    fireEvent.pointerDown(button);
    fireEvent.focus(button);

    expect(preloadThreadSecondaryPanel).toHaveBeenCalledTimes(2);
  });
});
