// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultAppSettings, type AppKeybindings } from "@bb/domain";
import { KeyboardSettingsSection } from "./KeyboardSettingsSection";

const testState = vi.hoisted(() => ({
  defaultKeybindings: [
    {
      command: "thread.new",
      desktopOnly: false,
      shortcut: {
        key: "o",
        mod: true,
        meta: false,
        control: false,
        alt: false,
        shift: true,
      },
      when: { all: ["mainSurface"], none: ["modalOpen"] },
    },
    {
      command: "thread.new",
      desktopOnly: true,
      shortcut: {
        key: "n",
        mod: true,
        meta: false,
        control: false,
        alt: false,
        shift: false,
      },
      when: { all: ["mainSurface"], none: ["modalOpen"] },
    },
    {
      command: "thread.jump.1",
      desktopOnly: false,
      shortcut: {
        key: "1",
        mod: false,
        meta: false,
        control: true,
        alt: false,
        shift: false,
      },
      when: {
        all: ["mainSurface", "webSurface", "macPlatform"],
        none: ["modalOpen"],
      },
    },
    {
      command: "thread.jump.1",
      desktopOnly: false,
      shortcut: {
        key: "1",
        mod: true,
        meta: false,
        control: false,
        alt: false,
        shift: true,
      },
      when: {
        all: ["mainSurface", "webSurface"],
        none: ["modalOpen", "macPlatform"],
      },
    },
    {
      command: "thread.jump.1",
      desktopOnly: true,
      shortcut: {
        key: "1",
        mod: true,
        meta: false,
        control: false,
        alt: false,
        shift: false,
      },
      when: { all: ["mainSurface"], none: ["modalOpen"] },
    },
  ] as AppKeybindings,
  generalMutate: vi.fn(),
  isDesktop: false,
  mutate: vi.fn(),
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      defaultKeybindings: testState.defaultKeybindings,
      generalSettings: defaultAppSettings,
      keybindingOverrides: [],
    },
  }),
}));

vi.mock("@/hooks/mutations/settings-mutations", () => ({
  useUpdateGeneralSettings: () => ({
    isPending: false,
    mutate: testState.generalMutate,
  }),
  useUpdateKeyboardSettings: () => ({
    isPending: false,
    mutate: testState.mutate,
  }),
}));

vi.mock("@/lib/bb-desktop", () => ({
  getBbDesktopInfo: () => (testState.isDesktop ? {} : null),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  testState.isDesktop = false;
});

describe("KeyboardSettingsSection", () => {
  it("turns keyboard hints off while preserving the full settings contract", () => {
    render(<KeyboardSettingsSection />);

    fireEvent.click(
      screen.getByRole("switch", {
        name: "Show keyboard hints when holding CMD / Control",
      }),
    );

    expect(testState.generalMutate).toHaveBeenCalledWith({
      ...defaultAppSettings,
      showKeyboardHints: false,
    });
  });

  it("records, clears, and resets a command shortcut", () => {
    render(<KeyboardSettingsSection />);
    const defaults = screen.getByLabelText("Default shortcuts for New thread");
    const webDefault = within(defaults).getByText("Ctrl + Shift + O");
    expect(webDefault.tagName).toBe("KBD");
    expect(webDefault.className).toContain("font-sans");
    expect(webDefault.getAttribute("aria-hidden")).toBe("false");
    const webLabel = within(defaults).getByText("Web");
    const webGroup = webLabel.parentElement;
    expect(webGroup?.className).toContain("border");
    expect(webGroup?.className).toContain("overflow-hidden");
    expect(webLabel.className).not.toContain("rounded");
    expect(within(webGroup!).getByText("Ctrl + Shift + O")).toBeDefined();
    const desktopDefault = within(defaults).getByText("Ctrl + N");
    expect(desktopDefault.tagName).toBe("KBD");
    expect(desktopDefault.className).toContain("font-sans");
    const desktopGroup = within(defaults).getByText("Desktop").parentElement;
    expect(desktopGroup?.className).toContain("border");
    expect(within(desktopGroup!).getByText("Ctrl + N")).toBeDefined();
    const recorder = screen.getByRole("button", {
      name: "Record shortcut for New thread, current shortcut Ctrl + Shift + O",
    });
    const recorderShortcut = within(recorder).getByText("Ctrl + Shift + O");
    expect(recorderShortcut.tagName).toBe("KBD");
    expect(recorderShortcut.className).toContain("font-sans");
    expect(recorderShortcut.className).toContain("bg-transparent");
    expect(recorderShortcut.getAttribute("aria-hidden")).toBe("true");

    fireEvent.click(recorder);
    expect(screen.getByText("Press keys")).toBeDefined();
    fireEvent.keyDown(recorder, {
      key: "U",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(testState.mutate).toHaveBeenLastCalledWith(
      [
        {
          command: "thread.new",
          shortcut: {
            key: "u",
            mod: true,
            meta: false,
            control: false,
            alt: false,
            shift: true,
          },
        },
      ],
      expect.objectContaining({ onError: expect.any(Function) }),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Clear shortcut for New thread",
      }),
    );
    expect(testState.mutate).toHaveBeenLastCalledWith(
      [{ command: "thread.new", shortcut: null }],
      expect.objectContaining({ onError: expect.any(Function) }),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Reset shortcut for New thread",
      }),
    );
    expect(testState.mutate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it("labels platform-specific web aliases and selects the active macOS default", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    render(<KeyboardSettingsSection />);

    const defaults = screen.getByLabelText(
      "Default shortcuts for Open thread 1",
    );
    const macWebGroup = within(defaults).getByText("macOS web").parentElement;
    expect(within(macWebGroup!).getByText("⌃ 1")).toBeDefined();
    const otherWebGroup =
      within(defaults).getByText("Windows/Linux web").parentElement;
    expect(within(otherWebGroup!).getByText("Ctrl + Shift + 1")).toBeDefined();
    const desktopGroup = within(defaults).getByText("Desktop").parentElement;
    expect(within(desktopGroup!).getByText("⌘ 1")).toBeDefined();
    expect(
      screen.getByRole("button", {
        name: "Record shortcut for Open thread 1, current shortcut ⌃ 1",
      }),
    ).toBeDefined();
  });

  it("selects the desktop-only alias in the desktop app", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    testState.isDesktop = true;
    render(<KeyboardSettingsSection />);

    expect(
      screen.getByRole("button", {
        name: "Record shortcut for Open thread 1, current shortcut ⌘ 1",
      }),
    ).toBeDefined();
  });
});
