// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppKeybindings, KeyboardCommandId } from "@bb/domain";
import { AppCommandProvider, useAppCommandHandler } from "./AppCommandProvider";

const state = vi.hoisted(() => ({
  setAppKeybindings: vi.fn(),
}));
const bindings: AppKeybindings = [
  {
    command: "plugin:example/open",
    desktopOnly: false,
    shortcut: {
      key: "i",
      mod: true,
      meta: false,
      control: false,
      alt: false,
      shift: true,
    },
    when: { all: ["mainSurface"], none: ["modalOpen"] },
  },
];

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: { generalSettings: { showKeyboardHints: false } },
  }),
}));
vi.mock("@/hooks/usePluginCommandBindings", () => ({
  usePluginCommandBindings: () => ({
    keybindings: bindings,
    defaults: bindings,
  }),
}));
vi.mock("@/lib/bb-desktop", () => ({
  getBbDesktopInfo: () => ({ setAppKeybindings: state.setAppKeybindings }),
}));

function Handler({
  available,
  command = "plugin:example/open",
}: {
  available: boolean;
  command?: KeyboardCommandId;
}) {
  useAppCommandHandler(
    command,
    () => true,
    0,
    true,
    () => available,
  );
  return null;
}

async function flushNativeBindings() {
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(() => {
  cleanup();
  state.setAppKeybindings.mockClear();
});

describe("native command registration", () => {
  it("updates plugin availability and removes it when the handler unmounts", async () => {
    const { rerender } = render(
      <AppCommandProvider>
        <Handler available />
      </AppCommandProvider>,
    );
    await flushNativeBindings();
    expect(state.setAppKeybindings).toHaveBeenLastCalledWith({
      keybindings: bindings,
      availableCommands: ["plugin:example/open"],
    });
    rerender(
      <AppCommandProvider>
        <Handler available={false} />
      </AppCommandProvider>,
    );
    await flushNativeBindings();
    expect(state.setAppKeybindings).toHaveBeenLastCalledWith({
      keybindings: bindings,
      availableCommands: [],
    });
    rerender(
      <AppCommandProvider>
        <Handler available />
      </AppCommandProvider>,
    );
    await flushNativeBindings();
    rerender(<AppCommandProvider>{null}</AppCommandProvider>);
    await flushNativeBindings();
    expect(state.setAppKeybindings).toHaveBeenLastCalledWith({
      keybindings: bindings,
      availableCommands: [],
    });
  });
});
