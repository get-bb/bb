// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopZoomIndicator } from "./DesktopZoomIndicator";

describe("DesktopZoomIndicator", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    delete window.bbDesktop;
  });

  function setup() {
    const changeListener = { current: (_factor: number) => undefined };
    const unsubscribe = vi.fn();
    const zoom = vi.fn();
    window.bbDesktop = {
      onZoomChange: vi.fn((callback) => {
        changeListener.current = callback;
        return unsubscribe;
      }),
      zoom,
    } as unknown as Window["bbDesktop"];
    const view = render(<DesktopZoomIndicator />);
    return {
      emitZoomChange: (factor: number) => changeListener.current(factor),
      unsubscribe,
      view,
      zoom,
    };
  }

  it("stays unrendered until a zoom change", () => {
    setup();

    expect(screen.queryByRole("toolbar", { name: "Zoom" })).toBeNull();
  });

  it("shows the changed percentage and dispatches zoom commands", () => {
    const { emitZoomChange, zoom } = setup();
    act(() => emitZoomChange(1.25));

    expect(screen.getByText("125%")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset zoom" }));
    expect(zoom.mock.calls).toEqual([["out"], ["in"], ["reset"]]);
  });

  it("disables Reset at 100 percent", () => {
    const { emitZoomChange } = setup();
    act(() => emitZoomChange(1));

    expect(
      (screen.getByRole("button", { name: "Reset zoom" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("auto-hides after two seconds", () => {
    vi.useFakeTimers();
    const { emitZoomChange } = setup();
    act(() => emitZoomChange(1.25));
    act(() => vi.advanceTimersByTime(2000));

    expect(screen.queryByRole("toolbar", { name: "Zoom" })).toBeNull();
  });

  it("stays visible while hovered", () => {
    vi.useFakeTimers();
    const { emitZoomChange } = setup();
    act(() => emitZoomChange(1.25));
    fireEvent.pointerEnter(screen.getByRole("toolbar", { name: "Zoom" }));
    act(() => vi.advanceTimersByTime(2500));

    expect(screen.getByRole("toolbar", { name: "Zoom" })).toBeTruthy();
  });

  it("renders nothing without zoom notifications and unsubscribes", () => {
    window.bbDesktop = {} as Window["bbDesktop"];
    const view = render(<DesktopZoomIndicator />);
    expect(view.container.childElementCount).toBe(0);
    view.unmount();

    const { unsubscribe, view: subscribedView } = setup();
    subscribedView.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
