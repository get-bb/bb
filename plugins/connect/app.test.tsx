// @vitest-environment jsdom
// Frontend coverage for the builtin Connect plugin's settings section, using
// the official plugin app harness instead of a host app or built bundle.
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";
import { CONNECT_REALTIME_CHANNEL, type ConnectStatus } from "@/src/types";

const app = await loadPluginApp(() => import("./app"));

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(cleanup);

function status(overrides: Partial<ConnectStatus> = {}): ConnectStatus {
  return {
    state: "disconnected",
    paired: false,
    handle: null,
    url: null,
    lastError: null,
    since: 1_700_000_000_000,
    remoteClients: 0,
    lastRemoteActivityAt: null,
    shares: [],
    ...overrides,
  };
}

describe("connect settings section", () => {
  it("pairs from the not-paired state and applies live paired status", async () => {
    expect(app.navPanels).toHaveLength(0);
    expect(app.settingsSections).toHaveLength(1);
    expect(app.settingsSections[0]?.id).toBe("remote-access");

    let currentStatus = status();
    const pairedStatus = status({
      state: "connected",
      paired: true,
      handle: "workstation",
      url: "https://workstation.getbb.app",
      since: 1_700_000_060_000,
    });

    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          status: () => currentStatus,
          pair: () => {
            return null;
          },
        },
      },
    );

    await slot.findByText("Set up remote access");
    fireEvent.change(slot.getByPlaceholderText("Paste your connect code"), {
      target: { value: " code-123 " },
    });
    fireEvent.click(slot.getByRole("button", { name: "Connect" }));

    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "pair",
        input: { code: "code-123" },
      }),
    );
    expect(slot.queryByText("https://workstation.getbb.app")).toBeNull();

    currentStatus = pairedStatus;
    await slot.emitRealtime(CONNECT_REALTIME_CHANNEL, pairedStatus);

    await slot.findByText("Connected");
    slot.getByText("https://workstation.getbb.app");
    slot.getByRole("button", { name: "Copy URL" });
  });

  it("renders shared ports with URLs and empty state", async () => {
    const emptySlot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          status: () =>
            status({
              state: "connected",
              paired: true,
              handle: "workstation",
              url: "https://workstation.getbb.app",
              shares: [],
            }),
        },
      },
    );

    await emptySlot.findByText("Shared ports");
    emptySlot.getByText(/No shared ports/);

    const withShares = status({
      state: "connected",
      paired: true,
      handle: "workstation",
      url: "https://workstation.getbb.app",
      shares: [
        {
          port: 5173,
          url: "https://workstation--5173.getbb.app",
        },
      ],
    });
    await emptySlot.emitRealtime(CONNECT_REALTIME_CHANNEL, withShares);

    await emptySlot.findByText("5173");
    const shareLink = emptySlot.getByRole("link", {
      name: "https://workstation--5173.getbb.app",
    });
    expect(shareLink.getAttribute("href")).toBe(
      "https://workstation--5173.getbb.app",
    );
    expect(emptySlot.queryByText(/No shared ports/)).toBeNull();
  });

  it("unexpose action fires the revoke RPC", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          status: () =>
            status({
              state: "connected",
              paired: true,
              handle: "workstation",
              url: "https://workstation.getbb.app",
              shares: [
                {
                  port: 3000,
                  url: "https://workstation--3000.getbb.app",
                },
              ],
            }),
          unexpose: () => ({ removed: true, port: 3000 }),
        },
      },
    );

    await slot.findByText("3000");
    fireEvent.click(slot.getByRole("button", { name: "Revoke" }));

    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "unexpose",
        input: { port: 3000 },
      }),
    );
  });

  it("share form calls expose RPC and surfaces errors", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          status: () =>
            status({
              state: "connected",
              paired: true,
              handle: "workstation",
              url: "https://workstation.getbb.app",
              shares: [],
            }),
          expose: () => {
            throw new Error("this bb is not connected to getbb.app");
          },
        },
      },
    );

    await slot.findByText("Shared ports");
    fireEvent.change(slot.getByLabelText("Port to share"), {
      target: { value: "8080" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Share" }));

    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "expose",
        input: { port: 8080 },
      }),
    );
    await slot.findByText(/this bb is not connected to getbb.app/);
  });
});
