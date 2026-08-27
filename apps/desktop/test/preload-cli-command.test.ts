import { describe, expect, it, vi } from "vitest";
import type {
  BbDesktopApi,
  BbDesktopCliCommandInstallResult,
  BbDesktopCliCommandStatus,
  BbDesktopInfo,
} from "@bb/desktop-contract";
import {
  BB_DESKTOP_CLI_COMMAND_AVAILABLE_CHANNEL,
  BB_DESKTOP_CLI_COMMAND_INSTALL_CHANNEL,
  BB_DESKTOP_CLI_COMMAND_STATUS_CHANNEL,
} from "../src/desktop-update-ipc.js";

const electronMock = vi.hoisted(() => {
  const desktopInfo: BbDesktopInfo = {
    lastCheckedAt: null,
    latestVersion: null,
    pendingVersion: null,
    platform: "macos",
    updateAvailable: false,
    updateDownloaded: false,
    version: "0.0.0-test",
  };

  let exposedApi: BbDesktopApi | null = null;
  let availableResult: Promise<unknown> = Promise.resolve(true);
  const invokeCalls: string[] = [];

  return {
    desktopInfo,
    get exposedApi() {
      return exposedApi;
    },
    invokeCalls,
    reset(): void {
      exposedApi = null;
      invokeCalls.length = 0;
      availableResult = Promise.resolve(true);
    },
    setAvailableResult(result: Promise<unknown>): void {
      availableResult = result;
    },
    contextBridge: {
      exposeInMainWorld(name: string, api: unknown): void {
        if (name === "bbDesktop") {
          exposedApi = api as BbDesktopApi;
        }
      },
    },
    ipcRenderer: {
      invoke(channel: string): Promise<unknown> {
        invokeCalls.push(channel);
        if (channel === BB_DESKTOP_CLI_COMMAND_AVAILABLE_CHANNEL) {
          return availableResult;
        }
        if (channel === BB_DESKTOP_CLI_COMMAND_STATUS_CHANNEL) {
          const status: BbDesktopCliCommandStatus = {
            binDir: "/home/user/.bb/bin",
            commandName: "bb",
            matches: [],
            onPath: false,
            ownEntryWins: false,
            wrapperInstalled: false,
          };
          return Promise.resolve(status);
        }
        if (channel === BB_DESKTOP_CLI_COMMAND_INSTALL_CHANNEL) {
          const result: BbDesktopCliCommandInstallResult = {
            outcome: "written",
            status: {
              binDir: "/home/user/.bb/bin",
              commandName: "bb",
              matches: ["/home/user/.bb/bin/bb"],
              onPath: true,
              ownEntryWins: true,
              wrapperInstalled: true,
            },
          };
          return Promise.resolve(result);
        }
        return Promise.resolve(desktopInfo);
      },
      on(): void {},
      send(): void {},
    },
    webFrame: {
      getZoomFactor(): number {
        return 1;
      },
    },
  };
});

vi.mock("electron", () => ({
  contextBridge: electronMock.contextBridge,
  ipcRenderer: electronMock.ipcRenderer,
  webFrame: electronMock.webFrame,
}));

/** Flush the microtask queue past `invoke().then(...)` in preload.ts. */
async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function loadPreload(): Promise<BbDesktopApi> {
  vi.resetModules();
  process.env.BB_DESKTOP_VERSION = "0.0.0-test";
  await import("../src/preload.js");
  const api = electronMock.exposedApi;
  expect(api).not.toBeNull();
  if (api === null) {
    throw new Error("Expected preload to expose window.bbDesktop.");
  }
  return api;
}

describe("desktop preload cliCommand availability", () => {
  it("exposes cliCommand once the main process reports the app is packaged", async () => {
    electronMock.reset();
    electronMock.setAvailableResult(Promise.resolve(true));
    const api = await loadPreload();

    await flushMicrotasks();
    expect(api.cliCommand).toBeDefined();

    // Also verify the install() bridge parses the new richer result shape.
    const result = await api.cliCommand?.install();
    expect(result).toEqual({
      outcome: "written",
      status: {
        binDir: "/home/user/.bb/bin",
        commandName: "bb",
        matches: ["/home/user/.bb/bin/bb"],
        onPath: true,
        ownEntryWins: true,
        wrapperInstalled: true,
      },
    });
  });

  it("never exposes cliCommand when the main process reports a dev build", async () => {
    // This is the settings-row half of the isPackaged gate: a dev build must
    // never render the row or be able to call install(), not just have the
    // IPC handler reject after the fact.
    electronMock.reset();
    electronMock.setAvailableResult(Promise.resolve(false));
    const api = await loadPreload();

    await flushMicrotasks();
    expect(api.cliCommand).toBeUndefined();
  });

  it("treats a rejected availability check as unavailable", async () => {
    electronMock.reset();
    electronMock.setAvailableResult(Promise.reject(new Error("no handler")));
    const api = await loadPreload();

    await flushMicrotasks();
    expect(api.cliCommand).toBeUndefined();
  });
});
