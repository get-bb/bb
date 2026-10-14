// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultAppSettings,
  type AppCommandId,
  type AppDefaultKeybinding,
} from "@bb/domain";
import {
  AppCommandProvider,
  useAppCommandRunner,
} from "@/components/commands/AppCommandProvider";
import { usePluginSafeModeCommands } from "./usePluginSafeModeCommands";

function unassigned(command: AppCommandId): AppDefaultKeybinding {
  return {
    command,
    desktopOnly: false,
    shortcut: null,
    when: { all: ["mainSurface"], none: ["modalOpen"] },
  };
}

const SAFE_MODE_BINDINGS = [
  unassigned("plugins.enterSafeMode"),
  unassigned("plugins.exitSafeMode"),
];

const testState = vi.hoisted(() => ({ safeMode: false }));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      generalSettings: { ...defaultAppSettings, showKeyboardHints: false },
      keybindings: [],
      defaultKeybindings: SAFE_MODE_BINDINGS,
    },
  }),
}));

vi.mock("@/hooks/queries/plugin-settings-queries", () => ({
  usePluginSafeMode: () => ({ data: testState.safeMode }),
}));

let runner: ReturnType<typeof useAppCommandRunner> | null = null;

function Harness() {
  usePluginSafeModeCommands();
  const value = useAppCommandRunner();
  useEffect(() => {
    runner = value;
  }, [value]);
  return null;
}

function renderHarness(safeMode: boolean): void {
  testState.safeMode = safeMode;
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AppCommandProvider>
          <Harness />
        </AppCommandProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  runner = null;
  vi.clearAllMocks();
});

describe("usePluginSafeModeCommands", () => {
  it("offers only the command that flips the current state", async () => {
    renderHarness(false);

    await waitFor(() => {
      expect(runner?.isCommandAvailable("plugins.enterSafeMode", null)).toBe(
        true,
      );
    });
    expect(runner?.isCommandAvailable("plugins.exitSafeMode", null)).toBe(
      false,
    );
  });
});
