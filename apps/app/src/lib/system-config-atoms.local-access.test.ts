import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchHostStatus: vi.fn(),
  fetchSystemConfig: vi.fn(async () => ({
    ok: true,
    json: async () => ({ hostDaemonPort: 38_887 }),
  })),
}));

vi.mock("./api-server", () => ({
  apiClient: {
    system: {
      config: {
        $get: mocks.fetchSystemConfig,
      },
    },
  },
}));

vi.mock("./api-host-daemon", () => ({
  fetchHostStatus: mocks.fetchHostStatus,
  fetchWorkspaceOpenTargets: vi.fn(async () => []),
}));

vi.mock("./bb-desktop", () => ({
  getBbDesktopInfo: () => null,
}));

vi.mock("./ws", () => ({
  wsManager: {
    onChanged: () => () => {},
    onConnected: () => () => {},
  },
}));

import {
  localHostDaemonAccessStateAtom,
  localHostStatusAtom,
  requestLocalHostDaemonAccessAtom,
} from "./system-config-atoms";

beforeEach(() => {
  mocks.fetchHostStatus.mockReset();
  vi.stubGlobal("window", {
    location: { hostname: "remote.getbb.app" },
  });
  vi.stubGlobal("navigator", {
    permissions: {
      query: vi.fn(async () => ({ state: "prompt" })),
    },
    userAgent: "test",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("local host daemon access atoms", () => {
  it("does not probe loopback while a remote page is in prompt state", async () => {
    const store = createStore();

    await expect(store.get(localHostDaemonAccessStateAtom)).resolves.toBe(
      "permission-required",
    );
    await expect(store.get(localHostStatusAtom)).resolves.toBeNull();
    expect(mocks.fetchHostStatus).not.toHaveBeenCalled();
  });

  it("makes one probe when access is explicitly requested", async () => {
    mocks.fetchHostStatus.mockResolvedValue(null);
    const store = createStore();

    await expect(store.set(requestLocalHostDaemonAccessAtom)).resolves.toBe(
      false,
    );
    expect(mocks.fetchHostStatus).toHaveBeenCalledExactlyOnceWith(38_887);
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
    mocks.fetchHostStatus.mockResolvedValue({
      connected: true,
      hostId: "host-local",
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
});
