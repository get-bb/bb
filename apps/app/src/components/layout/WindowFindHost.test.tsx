// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { defaultAppSettings } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBbDesktopApi } from "@/test/bb-desktop-test-utils";
import { AppCommandProvider } from "@/components/commands/AppCommandProvider";
import { WindowFindHost } from "./WindowFindHost";

const FIND_KEYBINDING = {
  command: "window.find" as const,
  desktopOnly: true,
  shortcut: {
    key: "f",
    mod: false,
    meta: false,
    control: true,
    alt: false,
    shift: false,
  },
  when: {
    all: ["mainSurface" as const],
    none: ["modalOpen" as const, "browserFocus" as const],
  },
};

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      generalSettings: defaultAppSettings,
      keybindings: [FIND_KEYBINDING],
    },
  }),
}));

const desktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos" as const,
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.0-test",
};

function renderFindHost() {
  const openWindowFind = vi.fn();
  window.bbDesktop = { ...createBbDesktopApi(desktopInfo), openWindowFind };
  render(
    <AppCommandProvider>
      <WindowFindHost />
      <button type="button">Somewhere in the app</button>
    </AppCommandProvider>,
  );
  return { openWindowFind };
}

function pressFindChord(buttonName: string) {
  fireEvent.keyDown(screen.getByRole("button", { name: buttonName }), {
    key: "f",
    code: "KeyF",
    ctrlKey: true,
  });
}

describe("WindowFindHost", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete window.bbDesktop;
  });

  it("opens the desktop find bar on the chord", () => {
    const { openWindowFind } = renderFindHost();

    pressFindChord("Somewhere in the app");

    expect(openWindowFind).toHaveBeenCalledTimes(1);
  });
});
