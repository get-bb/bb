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
import { pluginSafeModeQueryKey } from "@/hooks/queries/query-keys";
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
const setPluginSafeMode = vi.hoisted(() =>
  vi.fn((_fetch: unknown, enabled: boolean) => Promise.resolve(enabled)),
);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

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
  setPluginSafeMode,
}));

vi.mock("@/components/ui/app-toast", () => ({ appToast: toast }));

let runner: ReturnType<typeof useAppCommandRunner> | null = null;

function Harness() {
  usePluginSafeModeCommands();
  const value = useAppCommandRunner();
  useEffect(() => {
    runner = value;
  }, [value]);
  return null;
}

function renderHarness(safeMode: boolean): QueryClient {
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
  return queryClient;
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

  it("turns safe mode on and records the server's answer", async () => {
    const queryClient = renderHarness(false);
    await waitFor(() => {
      expect(runner?.isCommandAvailable("plugins.enterSafeMode", null)).toBe(
        true,
      );
    });

    runner?.dispatch("plugins.enterSafeMode", null);

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        "Plugin safe mode is on",
        expect.anything(),
      );
    });
    expect(setPluginSafeMode).toHaveBeenCalledWith(expect.anything(), true);
    expect(queryClient.getQueryData(pluginSafeModeQueryKey())).toBe(true);
  });

  it("turns safe mode off and reports a failure", async () => {
    setPluginSafeMode.mockRejectedValueOnce(new Error("server unavailable"));
    renderHarness(true);
    await waitFor(() => {
      expect(runner?.isCommandAvailable("plugins.exitSafeMode", null)).toBe(
        true,
      );
    });

    runner?.dispatch("plugins.exitSafeMode", null);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Failed to turn off plugin safe mode",
        { description: "server unavailable" },
      );
    });
    expect(setPluginSafeMode).toHaveBeenCalledWith(expect.anything(), false);
  });
});
