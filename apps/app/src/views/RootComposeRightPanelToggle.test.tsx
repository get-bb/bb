// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LazyThreadSecondaryPanel } from "@/components/secondary-panel/lazySecondaryPanelComponents";
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
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
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

  it("warms the panel from toggle intent but not from mounting the toggle", async () => {
    vi.useFakeTimers();
    const preload = vi
      .spyOn(LazyThreadSecondaryPanel, "preload")
      .mockResolvedValue(undefined);
    render(<RootComposeRightPanelToggle isOpen={false} onToggle={vi.fn()} />);

    await act(async () => vi.runAllTimersAsync());
    expect(preload).not.toHaveBeenCalled();
    expect(preloadThreadSecondaryPanel).not.toHaveBeenCalled();

    const button = screen.getByRole("button", { name: "Show right panel" });
    fireEvent.pointerEnter(button);
    fireEvent.pointerDown(button);
    fireEvent.focus(button);

    expect(preloadThreadSecondaryPanel).toHaveBeenCalledTimes(3);
  });
});
