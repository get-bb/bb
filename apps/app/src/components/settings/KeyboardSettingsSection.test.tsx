// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppKeybindings } from "@bb/domain";
import { KeyboardSettingsSection } from "./KeyboardSettingsSection";

const testState = vi.hoisted(() => ({
  defaultKeybindings: [
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
  ] as AppKeybindings,
  mutate: vi.fn(),
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      defaultKeybindings: testState.defaultKeybindings,
      keybindingOverrides: [],
    },
  }),
}));

vi.mock("@/hooks/mutations/settings-mutations", () => ({
  useUpdateKeyboardSettings: () => ({
    isPending: false,
    mutate: testState.mutate,
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("KeyboardSettingsSection", () => {
  it("records, clears, and resets a command shortcut", () => {
    render(<KeyboardSettingsSection />);
    const recorder = screen.getByRole("button", {
      name: "Record shortcut for New thread, current shortcut Ctrl+N",
    });

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
});
