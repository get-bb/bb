// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ConversationCollapsedRail } from "./ConversationCollapsedRail";
import { MACOS_TRAFFIC_LIGHT_RESERVE_TOP_CLASS } from "@/lib/bb-desktop";

const noop = () => {};

afterEach(() => {
  cleanup();
});

function getChevronIcon(): SVGElement {
  const icon = document.querySelector<SVGElement>(
    "[data-icon='ChevronRight']",
  );
  if (icon === null) {
    throw new Error("Expand chevron icon not found");
  }
  return icon;
}

describe("ConversationCollapsedRail", () => {
  it("drops the chevron below the traffic-light strip when desktop-macOS chrome owns the top-left", () => {
    render(
      <ConversationCollapsedRail
        collapsed
        isWorking={false}
        reserveTopForDesktopTrafficLights
        onExpand={noop}
      />,
    );

    expect(getChevronIcon().getAttribute("class")).toContain(
      MACOS_TRAFFIC_LIGHT_RESERVE_TOP_CLASS,
    );
  });

  it("does not reserve top space when the sidebar (or web chrome) is covering the traffic lights", () => {
    render(
      <ConversationCollapsedRail
        collapsed
        isWorking={false}
        reserveTopForDesktopTrafficLights={false}
        onExpand={noop}
      />,
    );

    expect(getChevronIcon().getAttribute("class")).not.toContain(
      MACOS_TRAFFIC_LIGHT_RESERVE_TOP_CLASS,
    );
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

    const button = screen.getByRole("button", { name: "Expand conversation" });
    expect(button.getAttribute("aria-hidden")).toBeNull();
    expect(button.hasAttribute("inert")).toBe(false);
  });
});
