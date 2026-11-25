// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import type {
  BbDesktopServerChoice,
  BbDesktopServerList,
} from "@bb/desktop-contract";
import {
  buildBridgeEventScript,
  buildBridgeInjectionScript,
  parsePageToShellMessage,
  type BridgeServer,
  type NativeShellHandshake,
} from "@bb/mobile-bridge";
import { createBbDesktopApi } from "../test/bb-desktop-test-utils";
import { getNativeShell, resetNativeShellForTests } from "./native-shell";
import { getServerChoices, resetServerChoicesForTests } from "./server-choices";
import {
  useIsDesktopLocalServerActive,
  useServerChoices,
} from "../hooks/useServerChoices";
import { pluginSdkAppImplementation } from "./plugin-sdk-app-impl";

const local: BbDesktopServerChoice = {
  id: "builtin",
  name: "This Mac",
  origin: "http://127.0.0.1:38886",
  kind: "local",
  active: true,
};
const studio: BbDesktopServerChoice = {
  id: "connect:studio",
  name: "Studio",
  origin: "https://studio.getbb.app",
  kind: "account",
  active: false,
};

function createDesktopApi() {
  return createBbDesktopApi({
    lastCheckedAt: null,
    latestVersion: null,
    pendingVersion: null,
    platform: "macos",
    updateAvailable: false,
    updateDownloaded: false,
    version: "test",
  });
}

function installDesktop() {
  const listeners = new Set<(choices: BbDesktopServerChoice[]) => void>();
  const responses: ((choices: BbDesktopServerChoice[]) => void)[] = [];
  const selectServer = vi.fn();
  window.bbDesktop = {
    ...createDesktopApi(),
    listServerChoices: () =>
      new Promise((resolve) => {
        responses.push(resolve);
      }),
    onServerChoicesChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    selectServer,
  };
  return {
    selectServer,
    requests: () => responses.length,
    async respond(index: number, choices: BbDesktopServerChoice[]) {
      responses[index]?.(choices);
      await Promise.resolve();
    },
    change(next: BbDesktopServerChoice[]) {
      for (const listener of listeners) listener(next);
    },
  };
}

function installDesktopWithServerList(
  connectServersSkipReason: BbDesktopServerList["connectServersSkipReason"],
) {
  const selectServer = vi.fn();
  const addServer = vi.fn();
  const signInToConnect = vi.fn();
  window.bbDesktop = {
    ...createDesktopApi(),
    listServerChoices: async () => [],
    onServerChoicesChange: () => () => {},
    getServerList: async () => ({
      servers: [local, studio],
      connectServersSkipReason,
    }),
    onServerListChange: () => () => {},
    selectServer,
    addServer,
    signInToConnect,
  };
  return { selectServer, addServer, signInToConnect };
}

const handshake: NativeShellHandshake = {
  bridgeVersion: 4,
  appVersion: "0.50.0",
  platform: "ios",
  profileMode: "connect",
  secureContext: true,
  safeArea: { top: 59, right: 0, bottom: 34, left: 0 },
  capabilities: ["haptic", "badge", "share", "open-external", "safe-area"],
};

function installMobile(
  servers?: readonly BridgeServer[],
  shellHandshake: NativeShellHandshake = handshake,
) {
  const posted: string[] = [];
  Object.defineProperty(window, "ReactNativeWebView", {
    configurable: true,
    value: { postMessage: (raw: string) => posted.push(raw) },
  });
  // eslint-disable-next-line no-new-func
  new Function("window", buildBridgeInjectionScript(shellHandshake, servers))(
    window,
  );
  return {
    posted,
    send(event: unknown) {
      // eslint-disable-next-line no-new-func
      new Function("window", buildBridgeEventScript(event))(window);
    },
  };
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "bbDesktop");
  Reflect.deleteProperty(window, "bb");
  Reflect.deleteProperty(window, "ReactNativeWebView");
  resetNativeShellForTests();
  resetServerChoicesForTests();
});

describe("server choices", () => {
  it.each(["browser", "older desktop", "mobile app without a list"])(
    "offers no servers in a %s",
    (client) => {
      if (client === "older desktop") {
        window.bbDesktop = {
          ...createDesktopApi(),
          getServerChoices: async () => [local],
          onServerChoicesChange: () => () => {},
          selectServer: () => {},
        };
      }
      if (client === "mobile app without a list") installMobile(undefined);
      expect(getServerChoices()).toBeNull();
      expect(renderHook(useServerChoices).result.current).toBeNull();
    },
  );

  it("loads desktop's list, follows changes, and switches by id", async () => {
    const desktop = installDesktop();
    const { result } = renderHook(useServerChoices);
    expect(result.current).toMatchObject({ status: "loading", servers: [] });
    await act(() => desktop.respond(0, [local, studio]));
    expect(result.current).toMatchObject({
      status: "ready",
      servers: [local, studio],
    });
    const switched = [
      { ...local, active: false },
      { ...studio, active: true },
    ];
    act(() => desktop.change(switched));
    expect(result.current?.servers).toEqual(switched);
    result.current?.switchTo("builtin");
    expect(desktop.selectServer).toHaveBeenCalledWith("builtin");
    expect(result.current).toMatchObject({
      addServer: null,
      accountSignIn: null,
    });
  });

  it("keeps a change desktop pushed while an older read was still in flight", async () => {
    const desktop = installDesktop();
    const { result } = renderHook(useServerChoices);
    const newer = [
      { ...local, active: false },
      { ...studio, active: true },
    ];
    act(() => desktop.change(newer));
    await act(() => desktop.respond(0, [local, studio]));
    expect(result.current?.servers).toEqual(newer);
  });

  it("re-reads desktop's list on each mount so account servers refresh", async () => {
    const desktop = installDesktop();
    const first = renderHook(useServerChoices);
    await act(() => desktop.respond(0, [local]));
    first.unmount();
    const second = renderHook(useServerChoices);
    expect(second.result.current).toMatchObject({
      status: "ready",
      servers: [local],
    });
    expect(desktop.requests()).toBe(2);
    await act(() => desktop.respond(1, [local, studio]));
    expect(second.result.current?.servers).toEqual([local, studio]);
  });

  it("shows the mobile app's list, follows its updates, and asks the app to switch", () => {
    const account: BridgeServer = { ...studio, id: "profile-1", active: true };
    const laptop: BridgeServer = {
      id: "profile-2",
      name: "Laptop",
      origin: "http://192.168.1.4:38886",
      kind: "custom",
      active: false,
    };
    const mobile = installMobile([account]);
    const { result } = renderHook(useServerChoices);
    expect(result.current).toMatchObject({
      status: "ready",
      servers: [account],
    });
    act(() => mobile.send({ type: "servers", servers: [account, laptop] }));
    expect(result.current?.servers).toEqual([account, laptop]);
    result.current?.switchTo("profile-2");
    const message = parsePageToShellMessage(mobile.posted.at(-1));
    expect(message).toEqual({
      ok: true,
      message: { type: "switch-server", id: "profile-2" },
    });
    expect(result.current).toMatchObject({
      addServer: null,
      accountSignIn: null,
    });
  });

  it("keeps the mobile bridge usable when the app's list is one this page cannot read", () => {
    installMobile([]);
    Reflect.set(Reflect.get(Reflect.get(window, "bb"), "native"), "servers", [
      { ...studio, kind: "teleport" },
    ]);
    expect(getServerChoices()).toBeNull();
    expect(getNativeShell()?.handshake.platform).toBe("ios");
  });
});

const usePluginServers = pluginSdkAppImplementation.experimental_useServers;

function PluginServers() {
  const choices = usePluginServers();
  if (choices === null) return null;
  return (
    <>
      {choices.servers.map((server) => (
        <button
          key={server.id}
          type="button"
          onClick={() => choices.switchTo(server.id)}
        >
          {server.name}
        </button>
      ))}
      {choices.accountSignIn === null ? null : (
        <button type="button" onClick={choices.accountSignIn.start}>
          {choices.accountSignIn.label}
        </button>
      )}
      {choices.addServer === null ? null : (
        <button type="button" onClick={choices.addServer}>
          Add server…
        </button>
      )}
    </>
  );
}

describe("useIsDesktopLocalServerActive", () => {
  it("is true only while a desktop window shows the desktop's own server", async () => {
    const desktop = installDesktop();
    const { result } = renderHook(useIsDesktopLocalServerActive);
    expect(result.current).toBe(false);
    await act(() => desktop.respond(0, [local, studio]));
    expect(result.current).toBe(true);
    act(() =>
      desktop.change([
        { ...local, active: false },
        { ...studio, active: true },
      ]),
    );
    expect(result.current).toBe(false);
  });

  it("is false in the mobile app even when its active server is local", () => {
    installMobile([{ ...local, id: "profile-1" }]);
    const { result } = renderHook(useIsDesktopLocalServerActive);
    expect(result.current).toBe(false);
  });
});

describe("experimental_useServers", () => {
  it("reports experimental_hasServers exactly where the hook has a value", () => {
    const hasServers = pluginSdkAppImplementation.experimental_hasServers;
    expect(hasServers()).toBe(false);
    expect(renderHook(() => usePluginServers()).result.current).toBeNull();
    resetServerChoicesForTests();
    installDesktopWithServerList(null);
    expect(hasServers()).toBe(true);
    expect(renderHook(() => usePluginServers()).result.current).not.toBeNull();
  });

  it("switches desktop and opens its Add Server dialog", async () => {
    const desktop = installDesktopWithServerList(null);
    render(<PluginServers />);
    fireEvent.click(await screen.findByRole("button", { name: /^Studio/ }));
    expect(desktop.selectServer).toHaveBeenCalledWith("connect:studio");
    fireEvent.click(screen.getByRole("button", { name: "Add server…" }));
    expect(desktop.addServer).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["no-credential", "Sign in to bb Connect…"],
    ["unauthorized", "Sign in to bb Connect again…"],
    ["unavailable", null],
    [null, null],
  ] as const)(
    "offers bb Connect sign-in when desktop skips %s only as its Server menu does",
    async (reason, label) => {
      const desktop = installDesktopWithServerList(reason);
      render(<PluginServers />);
      await screen.findByRole("button", { name: /^Studio/ });
      const signIn = screen.queryByRole("button", { name: /^Sign in/ });
      expect(signIn?.textContent ?? null).toBe(label);
      if (signIn !== null) fireEvent.click(signIn);
      expect(desktop.signInToConnect).toHaveBeenCalledTimes(label ? 1 : 0);
    },
  );

  it("asks the mobile app to switch and to open its Add server screen", () => {
    const mobile = installMobile(
      [
        { ...studio, active: true },
        { ...local, active: false },
      ],
      {
        ...handshake,
        bridgeVersion: 5,
        capabilities: [...handshake.capabilities, "open-native"],
      },
    );
    render(<PluginServers />);
    fireEvent.click(screen.getByRole("button", { name: /^This Mac/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add server…" }));
    expect(mobile.posted.map((raw) => parsePageToShellMessage(raw))).toEqual([
      { ok: true, message: { type: "switch-server", id: "builtin" } },
      { ok: true, message: { type: "open-native", screen: "add-server" } },
    ]);
  });
});
