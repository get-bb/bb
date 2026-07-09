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
});
