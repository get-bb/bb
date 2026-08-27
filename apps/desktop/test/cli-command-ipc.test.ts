import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BB_DESKTOP_CLI_COMMAND_AVAILABLE_CHANNEL,
  BB_DESKTOP_CLI_COMMAND_INSTALL_CHANNEL,
  BB_DESKTOP_CLI_COMMAND_STATUS_CHANNEL,
} from "../src/desktop-update-ipc.js";

type IpcHandler = (...args: unknown[]) => unknown;

const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, IpcHandler>();
  const app = { isPackaged: false };
  return {
    app,
    handlers,
    ipcMain: {
      handle(channel: string, listener: IpcHandler): void {
        handlers.set(channel, listener);
      },
    },
    reset(): void {
      handlers.clear();
      app.isPackaged = false;
    },
  };
});

vi.mock("electron", () => ({
  app: electronMock.app,
  ipcMain: electronMock.ipcMain,
}));

const silentLogger = { warn: () => {} };

afterEach(() => {
  electronMock.reset();
});

describe("registerCliCommandIpc", () => {
  it("registers only the availability channel, reporting unavailable, when not packaged", async () => {
    // This is the settings-row half of the critical gate: a dev build must
    // never expose a status/install handler that the renderer could invoke,
    // even accidentally (e.g. a stale window still showing the row).
    electronMock.app.isPackaged = false;
    const { registerCliCommandIpc } = await import("../src/cli-command-ipc.js");

    registerCliCommandIpc({ applicationName: "bb", logger: silentLogger });

    expect(electronMock.handlers.has(BB_DESKTOP_CLI_COMMAND_STATUS_CHANNEL)).toBe(
      false,
    );
    expect(
      electronMock.handlers.has(BB_DESKTOP_CLI_COMMAND_INSTALL_CHANNEL),
    ).toBe(false);

    const availableHandler = electronMock.handlers.get(
      BB_DESKTOP_CLI_COMMAND_AVAILABLE_CHANNEL,
    );
    expect(availableHandler).toBeDefined();
    expect(await availableHandler?.()).toBe(false);
  });

  it("registers all three channels, with availability true, when packaged", async () => {
    electronMock.app.isPackaged = true;
    const { registerCliCommandIpc } = await import("../src/cli-command-ipc.js");

    registerCliCommandIpc({ applicationName: "bb", logger: silentLogger });

    expect(electronMock.handlers.has(BB_DESKTOP_CLI_COMMAND_STATUS_CHANNEL)).toBe(
      true,
    );
    expect(
      electronMock.handlers.has(BB_DESKTOP_CLI_COMMAND_INSTALL_CHANNEL),
    ).toBe(true);

    const availableHandler = electronMock.handlers.get(
      BB_DESKTOP_CLI_COMMAND_AVAILABLE_CHANNEL,
    );
    expect(await availableHandler?.()).toBe(true);
  });
});
