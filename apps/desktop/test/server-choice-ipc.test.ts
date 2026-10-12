import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BbDesktopServerChoice } from "@bb/desktop-contract";
import { registerServerChoiceIpc } from "../src/server-choice-ipc.js";
import { buildDesktopServerChoices } from "../src/server-list.js";
import type { ConnectServerRef } from "../src/server-target.js";
import { createConnectServerSync } from "../src/connect-server-sync.js";
import {
  BB_DESKTOP_GET_SERVER_CHOICES_CHANNEL,
  BB_DESKTOP_SELECT_SERVER_CHANNEL,
} from "../src/desktop-window-command-ipc.js";

const ipc = vi.hoisted(() => ({ handle: vi.fn(), on: vi.fn() }));
vi.mock("electron", () => ({ ipcMain: ipc }));

const frame = {};
const event = { sender: { id: 7, mainFrame: frame }, senderFrame: frame };
const otherWindowEvent = {
  sender: { id: 8, mainFrame: frame },
  senderFrame: frame,
};

beforeEach(() => vi.clearAllMocks());

function choicesByWindow(webContentsId: number): BbDesktopServerChoice[] {
  return [
    { id: "builtin", name: "Local", active: webContentsId === 7 },
    { id: "remote", name: "Remote", active: webContentsId === 8 },
  ];
}

describe("server choice IPC", () => {
  it("uses the native discovery policy for list requests and keeps custom URLs private", async () => {
    let now = 100_000;
    let servers: ConnectServerRef[] = [];
    const customServerUrl = "https://user:password@custom.example/private";
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({
        ok: true,
        result: {
          selfHandle: "self",
          servers: [
            {
              handle: "remote",
              name: "Remote",
              live: true,
              url: "https://remote.example",
            },
          ],
        },
      }),
    }));
    const sync = createConnectServerSync({
      getCredential: () => null,
      getLocalServerUrl: () => "http://127.0.0.1:1234",
      onServers: (next) => {
        servers = next;
      },
      onSkipped: () => undefined,
      onUnauthorized: () => undefined,
      fetchImpl,
      now: () => now,
    });
    registerServerChoiceIpc({
      applicationWindowWebContentsIds: new Set([7]),
      onListRequested: sync.onListRequested,
      list: () =>
        buildDesktopServerChoices({
          activeTarget: { kind: "custom", url: customServerUrl },
          connectServers: servers,
          customServerUrls: [customServerUrl],
        }),
      select: async () => undefined,
      onError: () => undefined,
    });
    const list = ipc.handle.mock.calls.find(
      ([channel]) => channel === BB_DESKTOP_GET_SERVER_CHOICES_CHANNEL,
    )?.[1];
    if (!list) throw new Error("Missing list handler");
    const initial = list(event);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(initial).toEqual([
      { id: "builtin", name: expect.any(String), active: false },
      {
        id: expect.stringMatching(/^custom:[a-f0-9]{64}$/),
        name: "custom.example",
        active: true,
      },
    ]);
    expect(JSON.stringify(initial)).not.toContain("password");
    expect(JSON.stringify(initial)).not.toContain("/private");
    await sync.syncNow();
    expect(list(event)).toContainEqual({
      id: "connect:remote",
      name: "Remote",
      active: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    now += 60_000;
    list(event);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await sync.syncNow();
    expect(() => list({ ...event, senderFrame: {} })).toThrow(
      "limited to bb windows",
    );
    expect(() =>
      list({ ...event, sender: { id: 99, mainFrame: frame } }),
    ).toThrow("limited to bb windows");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("lists and switches servers for the window that asked", async () => {
    const select = vi.fn(async () => undefined);
    const onError = vi.fn();
    registerServerChoiceIpc({
      applicationWindowWebContentsIds: new Set([7, 8]),
      onListRequested: () => undefined,
      list: choicesByWindow,
      select,
      onError,
    });
    const list = ipc.handle.mock.calls.find(
      ([channel]) => channel === BB_DESKTOP_GET_SERVER_CHOICES_CHANNEL,
    )?.[1];
    if (!list) throw new Error("Missing list handler");
    expect(list(event)).toEqual(choicesByWindow(7));
    expect(list(otherWindowEvent)).toEqual(choicesByWindow(8));

    const request = ipc.on.mock.calls.find(
      ([channel]) => channel === BB_DESKTOP_SELECT_SERVER_CHANNEL,
    )?.[1];
    if (!request) throw new Error("Missing select handler");
    for (const id of ["builtin", "unknown", "https://injected.example", {}, ""])
      request(event, id);
    request(otherWindowEvent, "remote");
    request({ ...event, senderFrame: {} }, "remote");
    request({ ...event, sender: { id: 99, mainFrame: frame } }, "remote");
    expect(select).not.toHaveBeenCalled();

    request(event, "remote");
    request(otherWindowEvent, "builtin");
    expect(select.mock.calls).toEqual([
      [7, "remote"],
      [8, "builtin"],
    ]);
    select.mockRejectedValueOnce(new Error("disk full"));
    request(event, "remote");
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "disk full" }),
    );
  });
});
