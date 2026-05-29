// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ConversationCollapsedRail } from "./ConversationCollapsedRail";
import { MACOS_WINDOW_DRAG_CLASS } from "@/lib/bb-desktop";

const noop = () => {};
const RECESSED_BG_CLASS = "bg-surface-recessed";
const TRAFFIC_LIGHT_STRIP_TESTID =
  "conversation-collapsed-rail-traffic-light-strip";

afterEach(() => {
  cleanup();
});

function getExpandButton(): HTMLElement {
  return screen.getByRole("button", { name: "Expand conversation" });
}

describe("ConversationCollapsedRail", () => {
  it("reserves a transparent window-drag strip above the recessed body when desktop-macOS chrome owns the top-left", () => {
    render(
      <ConversationCollapsedRail
        collapsed
        isWorking={false}
        reserveTopForDesktopTrafficLights
        onExpand={noop}
      />,
    );

    const strip = screen.getByTestId(TRAFFIC_LIGHT_STRIP_TESTID);
    // The strip is the window-drag region the traffic lights sit on...
    expect(strip.className).toContain(MACOS_WINDOW_DRAG_CLASS);
    // ...and it must NOT carry the recessed background, so the lights render on
    // clean title-bar chrome instead of on top of the rail.
    expect(strip.className).not.toContain(RECESSED_BG_CLASS);
    // The recessed background lives on the body below the strip, not the strip.
    expect(getExpandButton().className).toContain(RECESSED_BG_CLASS);
  });

  it("does not reserve a top strip when the sidebar (or web chrome) is covering the traffic lights", () => {
    render(
      <ConversationCollapsedRail
        collapsed
        isWorking={false}
        reserveTopForDesktopTrafficLights={false}
        onExpand={noop}
      />,
    );

    // No traffic lights to clear: the recessed body fills the full height with
    // no transparent strip above it.
    expect(screen.queryByTestId(TRAFFIC_LIGHT_STRIP_TESTID)).toBeNull();
    expect(getExpandButton().className).toContain(RECESSED_BG_CLASS);
  });

  it("keeps the rail keyboard-accessible regardless of the reserve", () => {
    render(
      <ConversationCollapsedRail
        collapsed
        isWorking={false}
        reserveTopForDesktopTrafficLights
        onExpand={noop}
      />,
    );

    const button = getExpandButton();
    expect(button.getAttribute("aria-hidden")).toBeNull();
    expect(button.hasAttribute("inert")).toBe(false);
  });
});
