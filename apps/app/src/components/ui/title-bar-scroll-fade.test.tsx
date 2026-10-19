// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TitleBarScrollFade } from "./title-bar-scroll-fade";

const framedState = vi.hoisted(() => ({ framed: true }));

vi.mock("./sidebar.js", () => ({
  useIsSidebarFramed: () => framedState.framed,
}));

function renderScrollArea() {
  render(
    <div data-testid="host">
      <TitleBarScrollFade tone="background" />
      <div data-testid="scroller" style={{ overflowY: "auto" }}>
        <div data-testid="nested" style={{ overflowY: "auto" }} />
      </div>
    </div>,
  );
  return {
    fade: screen.getByTestId("title-bar-scroll-fade"),
    scroller: screen.getByTestId("scroller"),
    nested: screen.getByTestId("nested"),
  };
}

describe("TitleBarScrollFade", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    framedState.framed = true;
  });

  it("shows only while the scroller at the top edge has content scrolled under it", () => {
    const { fade, scroller } = renderScrollArea();
    expect(fade.hasAttribute("data-visible")).toBe(false);

    act(() => {
      scroller.scrollTop = 40;
      fireEvent.scroll(scroller);
    });
    expect(fade.hasAttribute("data-visible")).toBe(true);

    act(() => {
      scroller.scrollTop = 0;
      fireEvent.scroll(scroller);
    });
    expect(fade.hasAttribute("data-visible")).toBe(false);
  });

  it("ignores scrollers that do not start at the top edge", () => {
    const { fade, nested } = renderScrollArea();
    vi.spyOn(nested, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 120, 100, 100),
    );

    act(() => {
      nested.scrollTop = 40;
      fireEvent.scroll(nested);
    });
    expect(fade.hasAttribute("data-visible")).toBe(false);
  });

  it("renders nothing outside the framed macOS layout", () => {
    framedState.framed = false;
    render(<TitleBarScrollFade tone="background" />);
    expect(screen.queryByTestId("title-bar-scroll-fade")).toBeNull();
  });
});
