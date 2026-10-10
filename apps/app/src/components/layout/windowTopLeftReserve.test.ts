import { describe, expect, it } from "vitest";
import {
  BROWSER_COLLAPSED_HEADER_RESERVE_CLASS,
  MACOS_COLLAPSED_TOP_LEFT_RESERVE_CLASS,
} from "@/lib/bb-desktop";
import { resolveWindowTopLeftReserveClassName } from "./windowTopLeftReserve";

const desktopHidden = {
  isCompactViewport: false,
  isSidebarShowing: false,
  ownsWindowTopLeft: true,
  reserveMacosTrafficLights: false,
  sidebarKeepsCollapsedRail: false,
};

describe("resolveWindowTopLeftReserveClassName", () => {
  it.each([
    {
      name: "reserves the browser trigger slot when the sidebar slides fully away",
      input: desktopHidden,
      expected: BROWSER_COLLAPSED_HEADER_RESERVE_CLASS,
    },
    {
      name: "reserves nothing beside a collapsed rail, which keeps the trigger",
      input: { ...desktopHidden, sidebarKeepsCollapsedRail: true },
      expected: null,
    },
    {
      name: "reserves nothing beside a collapsed rail on macOS, where the title bar hosts the lights",
      input: {
        ...desktopHidden,
        reserveMacosTrafficLights: true,
        sidebarKeepsCollapsedRail: true,
      },
      expected: null,
    },
    {
      name: "keeps the full macOS reserve when no rail stays behind",
      input: { ...desktopHidden, reserveMacosTrafficLights: true },
      expected: MACOS_COLLAPSED_TOP_LEFT_RESERVE_CLASS,
    },
    {
      name: "still reserves the trigger slot on compact viewports while the drawer shows",
      input: {
        ...desktopHidden,
        isCompactViewport: true,
        isSidebarShowing: true,
      },
      expected: BROWSER_COLLAPSED_HEADER_RESERVE_CLASS,
    },
    {
      name: "reserves nothing while the desktop sidebar is showing",
      input: { ...desktopHidden, isSidebarShowing: true },
      expected: null,
    },
    {
      name: "reserves nothing for a header that does not own the window corner",
      input: { ...desktopHidden, ownsWindowTopLeft: false },
      expected: null,
    },
  ])("$name", ({ input, expected }) => {
    expect(resolveWindowTopLeftReserveClassName(input)).toBe(expected);
  });
});
