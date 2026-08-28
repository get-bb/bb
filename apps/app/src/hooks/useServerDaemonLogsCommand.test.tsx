// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useEffect } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AppDefaultKeybinding } from "@bb/domain";
import type { BbDesktopInfo } from "@bb/desktop-contract";
import {
  AppCommandProvider,
  useAppCommandRunner,
} from "@/components/commands/AppCommandProvider";
import { systemConfigQueryKey } from "@/hooks/queries/query-keys";
import { createBbDesktopApi } from "@/test/bb-desktop-test-utils";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { useServerDaemonLogsCommand } from "./useServerDaemonLogsCommand";

const LOGS_BINDING: AppDefaultKeybinding = {
  command: "logs.openServerDaemon",
  desktopOnly: true,
  shortcut: null,
  when: { all: ["mainSurface", "macPlatform"], none: ["modalOpen"] },
};

const openServerDaemonLogs = vi.hoisted(() => vi.fn(() => Promise.resolve()));

function makeDesktopInfo(serverDaemonLogsAvailable: boolean): BbDesktopInfo {
  return {
    downloadState: "idle",
    lastCheckedAt: null,
    latestVersion: null,
    pendingVersion: null,
    platform: "macos",
    serverDaemonLogsAvailable,
    updateAvailable: false,
    updateDownloaded: false,
    version: "0.0.0",
  };
}

let runner: ReturnType<typeof useAppCommandRunner> | null = null;

function Harness() {
  useServerDaemonLogsCommand();
  const value = useAppCommandRunner();
  useEffect(() => {
    runner = value;
  }, [value]);
  return null;
}

function renderHarness(available: boolean) {
  const desktopApi = createBbDesktopApi(makeDesktopInfo(available));
  desktopApi.openServerDaemonLogs = openServerDaemonLogs;
  window.bbDesktop = desktopApi;
  const { queryClient, wrapper } = createQueryClientTestHarness();
  queryClient.setQueryData(
    systemConfigQueryKey(),
    makeSystemConfig({
      defaultKeybindings: [LOGS_BINDING],
      keybindings: [],
    }),
  );
  return render(
    wrapper({
      children: (
        <MemoryRouter>
          <AppCommandProvider>
            <Harness />
          </AppCommandProvider>
        </MemoryRouter>
      ),
    }),
  );
}

function isAvailable(): boolean {
  return runner?.isCommandAvailable("logs.openServerDaemon", null) ?? false;
}

beforeAll(() => {
  Object.defineProperty(navigator, "platform", {
    configurable: true,
    value: "MacIntel",
  });
});

afterEach(() => {
  cleanup();
  delete window.bbDesktop;
  runner = null;
  vi.clearAllMocks();
});

describe("useServerDaemonLogsCommand", () => {
  it("offers the command and opens the viewer once the shell reports logs", async () => {
    renderHarness(true);

    await waitFor(() => {
      expect(isAvailable()).toBe(true);
    });
    runner?.dispatch("logs.openServerDaemon", null);
    expect(openServerDaemonLogs).toHaveBeenCalledTimes(1);
  });

  it("stays unavailable for an attached runtime, which has no logs to tail", async () => {
    renderHarness(false);

    await waitFor(() => {
      expect(runner).not.toBeNull();
    });
    expect(isAvailable()).toBe(false);
  });
});
