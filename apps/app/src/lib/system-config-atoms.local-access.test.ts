import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as apiHostDaemon from "./api-host-daemon";
import * as bbDesktop from "./bb-desktop";
import * as ws from "./ws";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import {
  hostDaemonPortAtom,
  localHostDaemonAccessStateAtom,
  localHostStatusAtom,
  requestLocalHostDaemonAccessAtom,
} from "./system-config-atoms";

const fetchHostStatus = vi.spyOn(apiHostDaemon, "fetchHostStatus");
const fetchSystemConfig = vi.fn();
const fetchWorkspaceOpenTargets = vi
  .spyOn(apiHostDaemon, "fetchWorkspaceOpenTargets")
  .mockResolvedValue([]);
vi.spyOn(bbDesktop, "getBbDesktopInfo").mockReturnValue(null);
vi.spyOn(ws.wsManager, "onChanged").mockReturnValue(() => {});
vi.spyOn(ws.wsManager, "onConnected").mockReturnValue(() => {});

beforeEach(() => {
  fetchHostStatus.mockReset();
  fetchSystemConfig.mockImplementation(async () => ({
    ok: true,
    json: async () =>
      makeSystemConfig({
        hostDaemonPort: 38_887,
        localHelperPorts: [38_887, 38_888],
      }),
  }));
  fetchWorkspaceOpenTargets.mockResolvedValue([]);
  vi.stubGlobal("fetch", fetchSystemConfig);
  vi.stubGlobal("window", {
    location: {
      hostname: "remote.getbb.app",
      origin: "https://remote.getbb.app",
    },
  });
  vi.stubGlobal("navigator", {
    permissions: {
      query: vi.fn(async () => ({ state: "prompt" })),
    },
    userAgent: "test",
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("local host daemon access atoms", () => {
  it("does not probe loopback while a remote page is in prompt state", async () => {
    const store = createStore();

    await expect(store.get(localHostDaemonAccessStateAtom)).resolves.toBe(
      "permission-required",
    );
    await expect(store.get(localHostStatusAtom)).resolves.toBeNull();
    expect(fetchHostStatus).not.toHaveBeenCalled();
  });

  it("probes every advertised helper port when access is explicitly requested", async () => {
    fetchHostStatus.mockResolvedValue(null);
    const store = createStore();

    await expect(store.set(requestLocalHostDaemonAccessAtom)).resolves.toBe(
      false,
    );
    expect(fetchHostStatus.mock.calls).toEqual([[38_887], [38_888]]);
  });

  it("keeps successful explicit access when permission queries are unsupported", async () => {
    vi.stubGlobal("navigator", {
      permissions: {
        query: vi.fn(async () => {
          throw new TypeError("unsupported permission");
        }),
      },
      userAgent: "test",
    });
    fetchHostStatus.mockResolvedValue({
      connected: true,
      hostId: "host-local",
      protocolVersion: 1,
      serverUrl: "https://remote.getbb.app",
      supportsNativeFolderPicker: false,
      platform: "unknown",
    });
    const store = createStore();

    await expect(store.get(localHostDaemonAccessStateAtom)).resolves.toBe(
      "unsupported",
    );
    await expect(store.set(requestLocalHostDaemonAccessAtom)).resolves.toBe(
      true,
    );
    await expect(store.get(localHostDaemonAccessStateAtom)).resolves.toBe(
      "available",
    );
  });

  it("prefers the helper enrolled with the server serving the browser", async () => {
    fetchHostStatus.mockImplementation(async (port: number) => ({
      connected: true,
      hostId: port === 38_888 ? "host-browser-machine" : "host-primary",
      protocolVersion: 1,
      serverUrl:
        port === 38_888 ? "https://remote.getbb.app" : "http://127.0.0.1:38886",
      supportsNativeFolderPicker: false,
      platform: "unknown",
    }));
    const store = createStore();

    await expect(store.set(requestLocalHostDaemonAccessAtom)).resolves.toBe(
      true,
    );
    await expect(store.get(hostDaemonPortAtom)).resolves.toBe(38_888);
    await expect(store.get(localHostStatusAtom)).resolves.toMatchObject({
      hostId: "host-browser-machine",
    });
  });

  it("retries unreachable helpers twice at one-second intervals", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", {
      permissions: {
        query: vi.fn(async () => ({ state: "granted" })),
      },
      userAgent: "test",
    });
    fetchHostStatus.mockResolvedValue(null);
    const store = createStore();

    const status = store.get(localHostStatusAtom);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchHostStatus).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(999);
    expect(fetchHostStatus).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchHostStatus).toHaveBeenCalledTimes(4);

    await vi.advanceTimersByTimeAsync(1_000);
    await expect(status).resolves.toBeNull();
    expect(fetchHostStatus).toHaveBeenCalledTimes(6);
  });
});
